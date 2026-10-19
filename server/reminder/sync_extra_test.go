package reminder

import (
	"testing"
	"time"

	"smallgo/server/database"
	"smallgo/server/timetable"
)

// 课程表与设置的双机同步（0.39.0）：用户 2026-10-19 要求「除密码外全部同步」。
func TestSyncTimetableAndSettings(t *testing.T) {
	withShanghaiLocal(t)
	dbA, dbB := newSyncDB(t), newSyncDB(t)
	userA := seedUser(t, dbA, "王耀辉", "admin")
	userB := seedUser(t, dbB, "王耀辉", "admin")

	table := timetable.Timetable{
		UserID: userA.ID, Name: "妹妹的课表", Location: "三班",
		LessonMinutes: 45, BreakMinutes: 10, PeriodCount: 8,
	}
	if err := dbA.Create(&table).Error; err != nil {
		t.Fatal(err)
	}
	entry := timetable.TimetableEntry{
		UserID: userA.ID, TimetableID: table.ID, Title: "数学", Kind: timetable.KindCourse,
		Weekday: 1, StartTime: "08:00", EndTime: "08:45", Location: "三班", Teacher: "李老师",
	}
	if err := dbA.Create(&entry).Error; err != nil {
		t.Fatal(err)
	}
	// 个人偏好 + 站点设置
	if err := dbA.Create(&database.SystemConfig{UserID: userA.ID, Key: "theme_mode", Value: "dark"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := dbA.Model(&database.SystemConfig{}).Where("user_id = 0 AND key = ?", "site_title").
		Updates(map[string]interface{}{"value": "家里的序记"}).Error; err != nil {
		t.Fatal(err)
	}
	// 密钥类键不能被带出去
	if err := dbA.Create(&database.SystemConfig{UserID: userA.ID, Key: "assistant_api_key", Value: "sk-secret"}).Error; err != nil {
		t.Fatal(err)
	}

	snap, err := buildSyncSnapshot(dbA)
	if err != nil {
		t.Fatal(err)
	}
	if len(snap.Timetables) != 1 || len(snap.TimetableEntries) != 1 {
		t.Fatalf("报文里没有课程表：%+v", snap.Timetables)
	}
	for _, cfg := range snap.UserConfigs {
		if cfg.Key == "assistant_api_key" {
			t.Fatal("API Key 不该出现在同步报文里")
		}
	}
	for _, cfg := range snap.SystemConfigs {
		if cfg.Key == "jwt_secret" || cfg.Key == "sync_token" {
			t.Fatalf("密钥 %q 不该出现在同步报文里", cfg.Key)
		}
	}

	stats, err := applySyncSnapshot(dbB, snap)
	if err != nil {
		t.Fatal(err)
	}
	if stats.TimetablesCreated != 1 || stats.EntriesCreated != 1 {
		t.Fatalf("课程表计数不对：%+v", stats)
	}

	var gotTable timetable.Timetable
	if err := dbB.Where("sync_uid = ?", table.SyncUID).First(&gotTable).Error; err != nil {
		t.Fatal(err)
	}
	if gotTable.UserID != userB.ID || gotTable.Name != "妹妹的课表" || gotTable.Location != "三班" {
		t.Fatalf("课程表落错了：%+v", gotTable)
	}
	var gotEntry timetable.TimetableEntry
	if err := dbB.Where("sync_uid = ?", entry.SyncUID).First(&gotEntry).Error; err != nil {
		t.Fatal(err)
	}
	if gotEntry.TimetableID != gotTable.ID || gotEntry.Title != "数学" || gotEntry.Weekday != 1 {
		t.Fatalf("条目落错了：%+v", gotEntry)
	}

	var theme database.SystemConfig
	if err := dbB.Where("user_id = ? AND key = ?", userB.ID, "theme_mode").First(&theme).Error; err != nil {
		t.Fatal(err)
	}
	if theme.Value != "dark" {
		t.Fatalf("个人偏好没同步：%q", theme.Value)
	}
	var site database.SystemConfig
	if err := dbB.Where("user_id = 0 AND key = ?", "site_title").First(&site).Error; err != nil {
		t.Fatal(err)
	}
	if site.Value != "家里的序记" {
		t.Fatalf("站点设置没同步：%q", site.Value)
	}

	// 再同步一次幂等。
	if second, err := applySyncSnapshot(dbB, snap); err != nil {
		t.Fatal(err)
	} else if second.total() != 0 {
		t.Fatalf("重复合并产生了改动：%+v", second)
	}

	// 删除必须带墓碑传过去：表与条目都软删，对端不能「复活」。
	time.Sleep(10 * time.Millisecond)
	if err := dbA.Where("timetable_id = ?", table.ID).Delete(&timetable.TimetableEntry{}).Error; err != nil {
		t.Fatal(err)
	}
	if err := dbA.Delete(&timetable.Timetable{}, table.ID).Error; err != nil {
		t.Fatal(err)
	}
	deleted, err := buildSyncSnapshot(dbA)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := applySyncSnapshot(dbB, deleted); err != nil {
		t.Fatal(err)
	}
	if err := dbB.Where("sync_uid = ?", entry.SyncUID).First(&timetable.TimetableEntry{}).Error; err == nil {
		t.Fatal("删除的课程条目在对端还查得到")
	}
	if err := dbB.Where("sync_uid = ?", table.SyncUID).First(&timetable.Timetable{}).Error; err == nil {
		t.Fatal("删除的课程表在对端还查得到")
	}
	var raw timetable.Timetable
	if err := dbB.Unscoped().Where("sync_uid = ?", table.SyncUID).First(&raw).Error; err != nil {
		t.Fatal(err)
	}
	if !raw.DeletedAt.Valid {
		t.Fatal("墓碑没传过来：对端下次同步会把它复活")
	}
}
