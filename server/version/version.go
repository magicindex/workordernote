package version

import "time"

// startedAt 进程启动时间：前端用它区分「本次运行」与「重启后」。
var startedAt = time.Now()

var (
	Version   = "dev"
	BuildTime = "unknown"
	GitCommit = "unknown"
	AppName   = "工作序记"
)

// GetVersion 返回 /api/version 的版本信息。值为 interface{} 而非 string：
// 调用方（server 路由）会往里并入非字符串字段（如 fnosApp 布尔），
// 现有字段仍全是字符串，JSON 形状不变。
func GetVersion() map[string]interface{} {
	return map[string]interface{}{
		"version":   Version,
		"buildTime": BuildTime,
		"gitCommit": GitCommit,
		"appName":   AppName,
		"startedAt": startedAt.Format(time.RFC3339),
	}
}

func PrintVersion() {
	println(AppName, Version)
	println("Version:", Version)
	println("BuildTime:", BuildTime)
	println("GitCommit:", GitCommit)
}
