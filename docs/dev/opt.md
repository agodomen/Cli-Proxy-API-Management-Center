# 运营手册

```bash
# 容器环境下进行volume的拷贝
docker run --rm \
  -v devcontainer_cpamc-proxy-data:/from \
  -v cpamc_cpamc-test-data:/to \
  alpine sh -c "cp -a /from/. /to/"
```