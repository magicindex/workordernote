package backup

import (
	"sync"
	"time"

	"gorm.io/gorm"

	"smallgo/server/logger"
	"smallgo/server/scheduler"
	"smallgo/server/sysconfig"
)

var scheduleOnce sync.Once

func registerSchedule() {
	scheduleOnce.Do(func() {
		scheduler.Register(scheduler.Job{
			Name:     "backup-daily",
			Interval: time.Minute,
			Run: func() {
				if appDB == nil {
					return
				}
				runIfDue(appDB, time.Now())
			},
		})
	})
}

// runIfDue 每分钟被叫一次：只看「已开启 + 到点 + 今天还没跑过」。
func runIfDue(db *gorm.DB, now time.Time) {
	enabled, _ := sysconfig.GetConfig(db, "backup_enabled", 0)
	if enabled != "true" {
		return
	}
	localOn, _ := sysconfig.GetConfig(db, "backup_local_enabled", 0)
	davOn, _ := sysconfig.GetConfig(db, "backup_webdav_enabled", 0)
	if localOn != "true" && davOn != "true" {
		return
	}
	clock, _ := sysconfig.GetConfig(db, "backup_time", 0)
	if now.Format("15:04") != clock {
		return
	}
	last, _ := sysconfig.GetConfig(db, "backup_last_at", 0)
	if last != "" {
		if at, err := time.Parse(time.RFC3339, last); err == nil && at.In(now.Location()).Format("2006-01-02") == now.Format("2006-01-02") {
			return
		}
	}
	if _, err := Run(db, now); err != nil {
		setStatus(db, now, "failed", err.Error())
		logger.Error("backup: %v", err)
	}
}
