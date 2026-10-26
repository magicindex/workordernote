// Package backup 每天把数据库与上传文件打成一个 tar.gz：可以落在本机目录，
// 也可以推到 WebDAV。备份是**整机**数据（所有用户、清单、提醒、完成记录、
// 课程表、配置与上传图片），因此只有管理员能配置和手动触发。
package backup

import "smallgo/server/sysconfig"

func init() {
	defs := []sysconfig.ConfigDef{
		{
			Key: "backup_enabled", Scope: sysconfig.ScopeSystem, Type: sysconfig.TypeBool, Default: "false",
			Group: "backup", Label: "自动备份",
			Description: "开启后每天在下面设定的时间备份一次数据库与上传文件（不含日志）",
		},
		{
			Key: "backup_time", Scope: sysconfig.ScopeSystem, Type: sysconfig.TypeTime, Default: "03:00",
			Group: "backup", Label: "备份时间",
			Description: "每天几点执行（按服务器本地时间）；应用没运行时错过的那天不会补跑",
		},
		{
			Key: "backup_local_enabled", Scope: sysconfig.ScopeSystem, Type: sysconfig.TypeBool, Default: "true",
			Group: "backup", Label: "备份到本机",
			Description: "把备份文件写到本机目录（默认是数据目录下的 backups 子目录）",
		},
		{
			Key: "backup_local_dir", Scope: sysconfig.ScopeSystem, Type: sysconfig.TypeString, Default: "",
			Group: "backup", Label: "本机备份目录",
			Description: "留空表示数据目录下的 backups（Docker 里是 /app/data/backups）。目录会被自动创建",
		},
		{
			Key: "backup_webdav_enabled", Scope: sysconfig.ScopeSystem, Type: sysconfig.TypeBool, Default: "false",
			Group: "backup", Label: "备份到 WebDAV",
			Description: "把同一份备份文件再推一份到 WebDAV 服务器（坚果云、群晖、Nextcloud 等）",
		},
		{
			Key: "backup_webdav_url", Scope: sysconfig.ScopeSystem, Type: sysconfig.TypeString, Default: "",
			Group: "backup", Label: "WebDAV 地址",
			Description: "文件夹地址，例如 https://dav.jianguoyun.com/dav/ 或 https://nas/dav/files/用户/备份",
		},
		{
			Key: "backup_webdav_username", Scope: sysconfig.ScopeSystem, Type: sysconfig.TypeString, Default: "",
			Group: "backup", Label: "WebDAV 用户名",
			Description: "Basic 认证用户名；不需要认证时留空",
		},
		{
			Key: "backup_webdav_password", Scope: sysconfig.ScopeSystem, Type: sysconfig.TypeString, Default: "",
			Group: "backup", Label: "WebDAV 密码",
			Description: "Basic 认证密码/应用密码，仅管理员可见；不会同步到另一台设备",
		},
		{
			Key: "backup_webdav_dir", Scope: sysconfig.ScopeSystem, Type: sysconfig.TypeString, Default: "workordernote",
			Group: "backup", Label: "WebDAV 子目录",
			Description: "在 WebDAV 地址下再建一层目录存放备份，不存在会自动创建；留空表示直接用地址目录",
		},
		{
			Key: "backup_webdav_insecure", Scope: sysconfig.ScopeSystem, Type: sysconfig.TypeBool, Default: "false",
			Group: "backup", Label: "跳过 HTTPS 证书校验",
			Description: "WebDAV 用自签名证书、或用 IP 访问而证书里没有对应 IP 时打开；会失去中间人防护，只在可信内网开启",
		},
		{
			Key: "backup_keep", Scope: sysconfig.ScopeSystem, Type: sysconfig.TypeInt, Default: "7",
			Group: "backup", Label: "保留份数",
			Description: "本机与 WebDAV 各保留最近几份，超出的自动删除；0 表示不删",
		},
		{
			Key: "backup_last_at", Scope: sysconfig.ScopeSystem, Type: sysconfig.TypeString, Default: "",
			Group: "backup", Label: "上次备份时间", Internal: true,
		},
		{
			Key: "backup_last_status", Scope: sysconfig.ScopeSystem, Type: sysconfig.TypeString, Default: "",
			Group: "backup", Label: "上次备份结果", Internal: true,
		},
		{
			Key: "backup_last_detail", Scope: sysconfig.ScopeSystem, Type: sysconfig.TypeString, Default: "",
			Group: "backup", Label: "上次备份详情", Internal: true,
		},
	}
	for _, def := range defs {
		sysconfig.RegisterConfig(def)
	}
}
