# Docker Compose 部署

需要 Docker 与 Compose v2。将 .env.docker.example 复制为 .env.docker，填写总管理员手机号及已开通的腾讯云短信配置。密钥文件只保存于服务器。

执行 docker compose up -d --build --wait，然后访问 http://服务器地址:8080 。也可运行 docker-start.cmd 或 docker-start.sh。

PRIVATE_DATA_HOST_DIR 默认为项目下的 private-data，Compose 将其只读挂载到 /app/private-data。镜像只包含程序代码；不会打包本地私有资料。空目录可以启动空系统。数据库与备份使用独立持久卷，重建容器会保留数据。

## 从本地系统迁移

1. 本地执行 npm run privacy:backup，得到 backups 下的私有 ZIP 包。
2. 将代码与私有包分开传到服务器。在一个新的项目目录执行 node scripts/privacy.js restore --from 备份包路径 --target 新目录。
3. 在新目录安装代码后，保留恢复出的 private-data。根据 .env.docker.example 配置 .env.docker，并沿用原 APP_SECRET。
4. 如需迁移已恢复的 SQLite 文件，在首次启动前将 data/production.sqlite 复制到 Compose 的 production_data 卷。Docker 不会自动把宿主机 data 目录作为数据库卷。

新空库默认不自动导入历史表格。只有明确设置 IMPORT_BUNDLED_DATA=true 且私有包包含 source-data/current.json 与对应月份原始工作簿时，才在业务空库执行一次初始化。已有业务不会被首次导入流程清空。

管理员、手机号、客户、产品和正式导出模板都来自本地私有资料。未恢复模板时，原格式导出会提示缺少本地模板；通用明细导出仍可使用。

公网部署可使用 compose.https.yaml 和 deploy/Caddyfile。设置 SITE_DOMAIN、ACME_EMAIL 和 TRUST_PROXY，短信凭证保持在服务器本地。所有登录验证码由短信服务发送，无统一验证码。

备份命令：docker compose exec app node scripts/backup.js。完整私有资料包需在宿主机同时保存配置、private-data 和数据库备份。
