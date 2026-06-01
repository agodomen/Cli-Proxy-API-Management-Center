package pluginhost

import (
	"context"

	"github.com/agodomen/Cli-Proxy-API-Management-Center/backend/sdk/pluginabi"
)

const pluginHostABIVersion = pluginabi.ABIVersion

type pluginClient interface {
	Call(ctx context.Context, method string, request []byte) ([]byte, error)
	Shutdown()
}

type pluginLoader interface {
	Open(file pluginFile, host *Host) (pluginClient, error)
}
