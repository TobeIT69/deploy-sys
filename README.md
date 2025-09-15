## ToBeIT'69 Deploy

```
cd ~/tobeit69
```

เข้ามาจะเจอไรเยอะแยะ [✨ = ระบบ Deploy จัดการ]

```
.
├── artifacts ✨
│   ├── tobeit69-client-main-8f78ce6.tar.gz
│   └── tobeit69-server-main-8f78ce6.tar.gz
├── deployments ✨
│   └── main
│       ├── client
│       ├── logs
│       ├── server
│       └── ecosystem.config.js
├── deploy-sys (🟦 current repo)
│   └── ...
├── dotenv ✨
│   ├── client
│   └── server
├── git (🔴 out monorepo)
│   └── ...
├── versions ✨
│   └── ...
├── deploy -> ./deploy-sys/deploy/bin/deploy.js
├── local-build -> ./deploy-sys/local-build.sh
└── prepare-deploy -> ./deploy-sys/scripts/collect-build-artifacts.sh
```

สั่ง build แบบระบุ env (git checkout, pull, install, copy env, build อัตโนมัติ)

```
./local-build {server, client} {main, staging, prod}
```

สร้าง build artifact สำหรับ deploy

```
./prepare-deploy server ./artifacts --root git
```

จะได้ output คล้าย ๆ แบบนี้

```
[2025-09-15 05:46:13] Artifact created successfully:
[2025-09-15 05:46:13]   Name: tobeit69-server-main-8f78ce6.tar.gz
[2025-09-15 05:46:13]   Path: /home/aona/tobeit69/artifacts/tobeit69-server-main-8f78ce6.tar.gz
[2025-09-15 05:46:13]   Size: 48K
[2025-09-15 05:46:13]   Package: server
[2025-09-15 05:46:13]   Environment: main
[2025-09-15 05:46:13]   Commit: 8f78ce6
[2025-09-15 05:46:13] Artifact collection completed successfully
```

จะได้ไฟล์ใหม่ในโฟลเดอร์ artifacts ชื่อ tobeit69-{package}-{env}-{commit-hash}.tar.gz ให้จำ path นี้ไว้

สั่ง deploy ขึ้น

```
./deploy deploy -a [ไฟล์ artifact]
```

ตัวระบบ deploy จัดการ copy runtime .env / แยก version ตาม commit / check ว่ารันไม่พัง / รันของจริงด้วย pm2 จบ

ตัว deploy มีคำสั่งอื่นที่ใช้ได้เช่น rollback, status, ฯลฯ อ่านใน [deploy/README.md](deploy/README.md)

ถ้าสมมติต้องการ update env vars ให้แก้ในโฟลเดอร์ dotenv ได้เลย ถ้าต้อง build ใหม่ก็สั่ง build ถ้าไม่ต้อง build ใหม่ (เช่น env ของ server) สั่ง deploy artifact ใหม้ได้
