package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	communityconfig "github.com/router-for-me/CLIProxyAPI/v7/internal/config"
	coreproxy "github.com/router-for-me/CLIProxyAPI/v7/internal/core/proxy"
	"github.com/router-for-me/CLIProxyAPI/v7/internal/pluginhost"
	communitypluginstore "github.com/router-for-me/CLIProxyAPI/v7/sdk/pluginstore"
	"gopkg.in/yaml.v3"
)

type corePluginStoreSourceError struct {
	SourceID   string `json:"source_id"`
	SourceName string `json:"source_name"`
	SourceURL  string `json:"source_url"`
	Message    string `json:"message"`
}

type corePluginStoreEntry struct {
	StoreID          string                          `json:"store_id"`
	SourceID         string                          `json:"source_id"`
	SourceName       string                          `json:"source_name"`
	SourceURL        string                          `json:"source_url"`
	ID               string                          `json:"id"`
	Name             string                          `json:"name"`
	Description      string                          `json:"description"`
	Author           string                          `json:"author"`
	Version          string                          `json:"version"`
	Repository       string                          `json:"repository"`
	InstallType      string                          `json:"install_type"`
	AuthRequired     bool                            `json:"auth_required"`
	AuthConfigured   bool                            `json:"auth_configured"`
	Platforms        []communitypluginstore.Platform `json:"platforms,omitempty"`
	Logo             string                          `json:"logo,omitempty"`
	Homepage         string                          `json:"homepage,omitempty"`
	License          string                          `json:"license,omitempty"`
	Tags             []string                        `json:"tags,omitempty"`
	Installed        bool                            `json:"installed"`
	InstalledVersion string                          `json:"installed_version"`
	Path             string                          `json:"path"`
	Configured       bool                            `json:"configured"`
	Registered       bool                            `json:"registered"`
	Enabled          bool                            `json:"enabled"`
	EffectiveEnabled bool                            `json:"effective_enabled"`
	UpdateAvailable  bool                            `json:"update_available"`
}

type corePluginStatus struct {
	Installed          bool
	InstalledVersion   string
	InstalledSourceID  string
	InstalledSourceURL string
	StoreManaged       bool
	Path               string
	Configured         bool
	Registered         bool
	Enabled            bool
	EffectiveEnabled   bool
}

type sourcedCorePlugin struct {
	source communitypluginstore.Source
	plugin communitypluginstore.Plugin
}

type corePluginInstallResponse struct {
	Status          string `json:"status"`
	SourceID        string `json:"source_id"`
	SourceName      string `json:"source_name"`
	SourceURL       string `json:"source_url"`
	ID              string `json:"id"`
	Version         string `json:"version"`
	InstallType     string `json:"install_type"`
	Path            string `json:"path"`
	PluginsEnabled  bool   `json:"plugins_enabled"`
	RestartRequired bool   `json:"restart_required"`
}

func (s *Server) handlePluginStore(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeIfConfigured(w, r) {
		return
	}
	cleanPath := strings.TrimRight(r.URL.Path, "/")
	const basePath = cpamcBase+"/plugin-store"
	switch {
	case cleanPath == basePath && r.Method == http.MethodGet:
		s.listCorePluginStore(w, r)
	case strings.HasPrefix(cleanPath, basePath+"/") && strings.HasSuffix(cleanPath, "/install") && r.Method == http.MethodPost:
		id := strings.TrimSuffix(strings.TrimPrefix(cleanPath, basePath+"/"), "/install")
		if strings.Contains(id, "/") || !pluginhost.ValidatePluginID(id) {
			writeError(w, http.StatusBadRequest, errors.New("invalid plugin id"))
			return
		}
		s.installCorePlugin(w, r, id)
	default:
		methodNotAllowed(w)
	}
}

func (s *Server) loadCorePluginConfig() (*communityconfig.Config, error) {
	if !s.cfg.LocalEngine.Enabled || strings.TrimSpace(s.cfg.LocalEngine.ConfigPath) == "" {
		return nil, errors.New("cpamc plugin store requires the local engine")
	}
	cfg, err := communityconfig.LoadConfig(s.cfg.LocalEngine.ConfigPath)
	if err != nil {
		return nil, fmt.Errorf("load local engine config: %w", err)
	}
	if cfg.Plugins.Configs == nil {
		cfg.Plugins.Configs = make(map[string]communityconfig.PluginInstanceConfig)
	}
	return cfg, nil
}

func (s *Server) corePluginStoreClient(registryURL string, auth []communitypluginstore.AuthConfig) communitypluginstore.Client {
	client := coreproxy.NewDynamicHTTPDoer(func() coreproxy.Resolution {
		return s.resolvePluginProxyResolution(context.Background())
	})
	return communitypluginstore.NewClientWithAuth(client, registryURL, auth)
}

func (s *Server) listCorePluginStore(w http.ResponseWriter, r *http.Request) {
	cfg, err := s.loadCorePluginConfig()
	if err != nil {
		writeError(w, http.StatusPreconditionRequired, err)
		return
	}
	pluginsDir, err := communityconfig.ResolvePluginsDir(cfg.Plugins.Dir)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	sources, err := communitypluginstore.NormalizeSources(cfg.Plugins.StoreSources)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	plugins, sourceErrors := s.fetchCoreStorePlugins(r.Context(), sources, cfg.Plugins.StoreAuth)
	if len(plugins) == 0 && len(sourceErrors) > 0 {
		writeJSON(w, http.StatusBadGateway, map[string]any{
			"error": "plugin_store_registry_failed", "message": sourceErrors[0].Message,
		})
		return
	}
	statuses, err := corePluginStatuses(cfg.Plugins.Enabled, pluginsDir, cfg.Plugins.Configs, s.pluginRegistered)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	latestVersions := s.coreLatestPluginVersions(r.Context(), plugins, cfg.Plugins.StoreAuth)
	entries := make([]corePluginStoreEntry, 0, len(plugins))
	for index, item := range plugins {
		status := statuses[item.plugin.ID]
		storeVersion := strings.TrimSpace(item.plugin.Version)
		if latestVersions[index] != "" {
			storeVersion = latestVersions[index]
		}
		sourceMatches := corePluginSourceMatches(status, item.source)
		entries = append(entries, corePluginStoreEntry{
			StoreID:          item.source.ID + "/" + item.plugin.ID,
			SourceID:         item.source.ID,
			SourceName:       item.source.Name,
			SourceURL:        item.source.URL,
			ID:               item.plugin.ID,
			Name:             item.plugin.Name,
			Description:      item.plugin.Description,
			Author:           item.plugin.Author,
			Version:          storeVersion,
			Repository:       item.plugin.Repository,
			InstallType:      communitypluginstore.PluginInstallType(item.plugin),
			AuthRequired:     item.plugin.AuthRequired,
			AuthConfigured:   communitypluginstore.PluginAuthConfigured(item.source, item.plugin, cfg.Plugins.StoreAuth),
			Platforms:        communitypluginstore.PluginPlatforms(item.plugin),
			Logo:             item.plugin.Logo,
			Homepage:         item.plugin.Homepage,
			License:          item.plugin.License,
			Tags:             append([]string(nil), item.plugin.Tags...),
			Installed:        status.Installed,
			InstalledVersion: status.InstalledVersion,
			Path:             status.Path,
			Configured:       status.Configured,
			Registered:       status.Registered,
			Enabled:          status.Enabled,
			EffectiveEnabled: status.EffectiveEnabled,
			UpdateAvailable:  sourceMatches && communitypluginstore.UpdateAvailable(status.InstalledVersion, storeVersion),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"plugins_enabled": cfg.Plugins.Enabled,
		"plugins_dir":     pluginsDir,
		"source_errors":   sourceErrors,
		"plugins":         entries,
	})
}

func (s *Server) fetchCoreStorePlugins(ctx context.Context, sources []communitypluginstore.Source, auth []communitypluginstore.AuthConfig) ([]sourcedCorePlugin, []corePluginStoreSourceError) {
	plugins := make([]sourcedCorePlugin, 0)
	errorsBySource := make([]corePluginStoreSourceError, 0)
	for _, source := range sources {
		client := s.corePluginStoreClient(source.URL, auth)
		registry, err := client.FetchRegistry(ctx)
		if err != nil {
			errorsBySource = append(errorsBySource, corePluginStoreSourceError{
				SourceID: source.ID, SourceName: source.Name, SourceURL: source.URL, Message: err.Error(),
			})
			continue
		}
		for _, plugin := range registry.Plugins {
			plugins = append(plugins, sourcedCorePlugin{source: source, plugin: plugin})
		}
	}
	return plugins, errorsBySource
}

func corePluginStatuses(pluginsEnabled bool, pluginsDir string, configs map[string]communityconfig.PluginInstanceConfig, registered func(string) bool) (map[string]corePluginStatus, error) {
	statuses := make(map[string]corePluginStatus)
	files, err := pluginhost.DiscoverPluginFiles(pluginsDir, corePluginDesiredVersions(configs))
	if err != nil {
		return nil, fmt.Errorf("discover plugins: %w", err)
	}
	for _, file := range files {
		status := statuses[file.ID]
		status.Installed = true
		status.InstalledVersion = strings.TrimSpace(file.Version)
		status.Path = file.Path
		statuses[file.ID] = status
	}
	for id, item := range configs {
		status := statuses[id]
		status.Configured = true
		status.Enabled = item.Enabled != nil && *item.Enabled
		status.InstalledSourceID, status.InstalledSourceURL, status.StoreManaged = coreConfiguredPluginSource(item)
		if registered != nil {
			status.Registered = registered(id)
		}
		statuses[id] = status
	}
	if registered != nil {
		for id, status := range statuses {
			status.Registered = registered(id)
			statuses[id] = status
		}
	}
	for id, status := range statuses {
		status.EffectiveEnabled = pluginsEnabled && status.Enabled && status.Registered
		statuses[id] = status
	}
	return statuses, nil
}

func (s *Server) coreLatestPluginVersions(ctx context.Context, plugins []sourcedCorePlugin, auth []communitypluginstore.AuthConfig) []string {
	versions := make([]string, len(plugins))
	var wait sync.WaitGroup
	for index := range plugins {
		if communitypluginstore.PluginInstallType(plugins[index].plugin) != communitypluginstore.InstallTypeGitHubRelease {
			continue
		}
		wait.Add(1)
		go func(index int) {
			defer wait.Done()
			client := s.corePluginStoreClient(plugins[index].source.URL, auth)
			release, err := client.FetchLatestRelease(ctx, plugins[index].plugin)
			if err != nil {
				return
			}
			versions[index], _ = communitypluginstore.ReleaseVersion(release)
		}(index)
	}
	wait.Wait()
	return versions
}

func (s *Server) installCorePlugin(w http.ResponseWriter, r *http.Request, id string) {
	cfg, err := s.loadCorePluginConfig()
	if err != nil {
		writeError(w, http.StatusPreconditionRequired, err)
		return
	}
	pluginsDir, err := communityconfig.ResolvePluginsDir(cfg.Plugins.Dir)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	sources, err := communitypluginstore.NormalizeSources(cfg.Plugins.StoreSources)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	requestedVersion, err := coreRequestedPluginVersion(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	requestedSource := strings.TrimSpace(r.URL.Query().Get("source"))
	installCtx := context.WithoutCancel(r.Context())
	installCtx, cancel := context.WithTimeout(installCtx, 20*time.Minute)
	defer cancel()
	var selected sourcedCorePlugin
	found := false
	for _, source := range sources {
		if requestedSource != "" && source.ID != requestedSource {
			continue
		}
		client := s.corePluginStoreClient(source.URL, cfg.Plugins.StoreAuth)
		registry, fetchErr := client.FetchRegistry(installCtx)
		if fetchErr != nil {
			continue
		}
		for _, plugin := range registry.Plugins {
			if plugin.ID == id {
				selected = sourcedCorePlugin{source: source, plugin: plugin}
				found = true
				break
			}
		}
		if found {
			break
		}
	}
	if !found {
		writeError(w, http.StatusNotFound, errors.New("plugin not found in selected store source"))
		return
	}
	if item, configured := cfg.Plugins.Configs[id]; configured {
		status := corePluginStatus{}
		status.InstalledSourceID, status.InstalledSourceURL, status.StoreManaged = coreConfiguredPluginSource(item)
		if status.StoreManaged && !corePluginSourceMatches(status, selected.source) {
			writeError(w, http.StatusConflict, errors.New("installed plugin belongs to a different store source; uninstall it before switching sources"))
			return
		}
	}
	client := s.corePluginStoreClient(selected.source.URL, cfg.Plugins.StoreAuth)
	options := communitypluginstore.InstallOptions{PluginsDir: pluginsDir, GOOS: runtime.GOOS, GOARCH: runtime.GOARCH}
	if s.pluginBusy != nil {
		options.PluginLoaded = func() bool { return s.pluginBusy(id) }
	}
	var result communitypluginstore.InstallResult
	var manifest communitypluginstore.Manifest
	switch communitypluginstore.PluginInstallType(selected.plugin) {
	case communitypluginstore.InstallTypeDirect:
		manifest, err = coreDirectPluginManifest(selected.source, selected.plugin, requestedVersion)
		if err == nil {
			result, err = client.InstallManifest(installCtx, manifest, options)
		}
	case communitypluginstore.InstallTypeGitHubRelease:
		result, err = coreInstallGitHubRelease(installCtx, client, selected.plugin, requestedVersion, options)
		if err == nil {
			manifest, err = coreManifestForInstall(selected.source, selected.plugin, result)
		}
	default:
		err = fmt.Errorf("unsupported install type %q", selected.plugin.Install.Type)
	}
	if err != nil {
		status := http.StatusBadGateway
		if errors.Is(err, communitypluginstore.ErrLoadedPluginLocked) {
			status = http.StatusConflict
		}
		writeError(w, status, err)
		return
	}
	if err = saveCorePluginManifest(s.cfg.LocalEngine.ConfigPath, cfg, id, manifest); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"error": "config_save_failed", "message": err.Error(), "path": result.Path,
		})
		return
	}
	writeJSON(w, http.StatusOK, corePluginInstallResponse{
		Status:          "installed",
		SourceID:        selected.source.ID,
		SourceName:      selected.source.Name,
		SourceURL:       selected.source.URL,
		ID:              result.ID,
		Version:         result.Version,
		InstallType:     result.InstallType,
		Path:            result.Path,
		PluginsEnabled:  cfg.Plugins.Enabled,
		RestartRequired: false,
	})
}

func coreRequestedPluginVersion(r *http.Request) (string, error) {
	queryVersion := strings.TrimSpace(r.URL.Query().Get("version"))
	if r.Body == nil || r.Body == http.NoBody {
		return queryVersion, nil
	}
	var body struct {
		Version string `json:"version"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return "", fmt.Errorf("decode install request: %w", err)
	}
	bodyVersion := strings.TrimSpace(body.Version)
	if queryVersion != "" && bodyVersion != "" && coreNormalizePluginVersion(queryVersion) != coreNormalizePluginVersion(bodyVersion) {
		return "", errors.New("version query does not match request body")
	}
	if queryVersion != "" {
		return queryVersion, nil
	}
	return bodyVersion, nil
}

func coreDirectPluginManifest(source communitypluginstore.Source, plugin communitypluginstore.Plugin, requestedVersion string) (communitypluginstore.Manifest, error) {
	version := coreNormalizePluginVersion(requestedVersion)
	if version == "" {
		version = coreNormalizePluginVersion(plugin.Version)
	}
	if coreNormalizePluginVersion(plugin.Version) == version {
		plugin.Version = version
		return communitypluginstore.ManifestFromPlugin(source, plugin)
	}
	for _, candidate := range plugin.Versions {
		if coreNormalizePluginVersion(candidate.Version) == version {
			plugin.Version = version
			plugin.Install = candidate.Install
			if strings.TrimSpace(plugin.Install.Type) == "" {
				plugin.Install.Type = communitypluginstore.InstallTypeDirect
			}
			return communitypluginstore.ManifestFromPlugin(source, plugin)
		}
	}
	return communitypluginstore.Manifest{}, fmt.Errorf("direct plugin version %q not found", version)
}

func coreInstallGitHubRelease(ctx context.Context, client communitypluginstore.Client, plugin communitypluginstore.Plugin, requestedVersion string, options communitypluginstore.InstallOptions) (communitypluginstore.InstallResult, error) {
	version := coreNormalizePluginVersion(requestedVersion)
	if version == "" {
		return client.Install(ctx, plugin, options)
	}
	tags := []string{requestedVersion}
	if strings.HasPrefix(strings.ToLower(requestedVersion), "v") {
		tags = append(tags, strings.TrimSpace(requestedVersion[1:]))
	} else {
		tags = append(tags, "v"+requestedVersion)
	}
	var errs []error
	for _, tag := range tags {
		result, err := client.InstallVersion(ctx, plugin, tag, version, options)
		if err == nil {
			return result, nil
		}
		errs = append(errs, err)
	}
	return communitypluginstore.InstallResult{}, errors.Join(errs...)
}

func coreManifestForInstall(source communitypluginstore.Source, plugin communitypluginstore.Plugin, result communitypluginstore.InstallResult) (communitypluginstore.Manifest, error) {
	if result.InstallType == communitypluginstore.InstallTypeDirect {
		plugin.Version = result.Version
		return communitypluginstore.ManifestFromPlugin(source, plugin)
	}
	if result.InstallType == communitypluginstore.InstallTypeGitHubRelease {
		return communitypluginstore.ManifestFromRelease(source, plugin, communitypluginstore.Release{TagName: result.ReleaseTag})
	}
	return communitypluginstore.Manifest{}, fmt.Errorf("unsupported install type %q", result.InstallType)
}

func saveCorePluginManifest(configPath string, cfg *communityconfig.Config, id string, manifest communitypluginstore.Manifest) error {
	item := cfg.Plugins.Configs[id]
	node := item.Raw
	if node.Kind != yaml.MappingNode {
		node = yaml.Node{Kind: yaml.MappingNode, Tag: "!!map"}
	}
	setCoreYAMLValue(&node, "enabled", &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!bool", Value: "true"})
	var manifestNode yaml.Node
	if err := manifestNode.Encode(manifest); err != nil {
		return fmt.Errorf("encode plugin store manifest: %w", err)
	}
	setCoreYAMLValue(&node, "store", &manifestNode)
	var updated communityconfig.PluginInstanceConfig
	if err := node.Decode(&updated); err != nil {
		return fmt.Errorf("decode plugin config: %w", err)
	}
	cfg.Plugins.Configs[id] = updated
	if err := communityconfig.SaveConfigPreserveComments(configPath, cfg); err != nil {
		return fmt.Errorf("save local engine config: %w", err)
	}
	return nil
}

func setCoreYAMLValue(node *yaml.Node, key string, value *yaml.Node) {
	for index := 0; index+1 < len(node.Content); index += 2 {
		if node.Content[index].Value == key {
			node.Content[index+1] = value
			return
		}
	}
	node.Content = append(node.Content,
		&yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: key}, value,
	)
}

func corePluginDesiredVersions(configs map[string]communityconfig.PluginInstanceConfig) map[string]string {
	keys := make([]string, 0, len(configs))
	for id := range configs {
		keys = append(keys, id)
	}
	sort.Strings(keys)
	out := make(map[string]string)
	for _, id := range keys {
		item := configs[id]
		storeNode := coreYAMLMappingValue(&item.Raw, "store")
		version := coreYAMLScalar(coreYAMLMappingValue(storeNode, "version"))
		if version == "" {
			version = coreYAMLScalar(coreYAMLMappingValue(storeNode, "release-tag"))
		}
		if normalized := coreNormalizePluginVersion(version); normalized != "" {
			out[id] = normalized
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func coreConfiguredPluginSource(item communityconfig.PluginInstanceConfig) (sourceID string, sourceURL string, managed bool) {
	storeNode := coreYAMLMappingValue(&item.Raw, "store")
	if storeNode == nil {
		return "", "", false
	}
	var manifest communitypluginstore.Manifest
	if err := storeNode.Decode(&manifest); err != nil {
		return "", "", true
	}
	return strings.TrimSpace(manifest.SourceID), strings.TrimSpace(manifest.SourceURL), true
}

func corePluginSourceMatches(status corePluginStatus, source communitypluginstore.Source) bool {
	if !status.StoreManaged {
		return true
	}
	configuredID := strings.TrimSpace(status.InstalledSourceID)
	configuredURL := strings.TrimSpace(status.InstalledSourceURL)
	if configuredID != "" && configuredID != strings.TrimSpace(source.ID) {
		return false
	}
	if configuredURL != "" && configuredURL != strings.TrimSpace(source.URL) {
		return false
	}
	return configuredID != "" || configuredURL != ""
}

func coreYAMLMappingValue(node *yaml.Node, key string) *yaml.Node {
	if node == nil || node.Kind != yaml.MappingNode {
		return nil
	}
	for index := 0; index+1 < len(node.Content); index += 2 {
		if node.Content[index].Value == key {
			return node.Content[index+1]
		}
	}
	return nil
}

func coreYAMLScalar(node *yaml.Node) string {
	if node == nil || node.Kind != yaml.ScalarNode {
		return ""
	}
	return strings.TrimSpace(node.Value)
}

func coreNormalizePluginVersion(version string) string {
	version = strings.TrimSpace(version)
	if strings.HasPrefix(strings.ToLower(version), "v") {
		return strings.TrimSpace(version[1:])
	}
	return version
}
