package reminder

import (
	"errors"
	"sync"
	"time"

	"gorm.io/gorm"
)

// 「人生要有仪式感」是侧栏里与「信用卡账单 / 记事本」并列的第三个**固定栏目**：
//
//   - 生日、结婚纪念日、情人节、七夕、中秋、高考……这些「一年一次」的事项都收在这一栏；
//   - 栏目的显示由个人偏好 ceremony_enabled 控制（默认开，后台偏好里可开关）；
//   - **关掉只是隐藏**：栏目行从侧栏摘掉，条目一条都不删，重新打开就原样回来。
//
// 与记事本同一套写法（见 note_bucket.go）：这里也**不删除任何行**——删了会通过双机
// 同步把对端的条目一起删掉，而「关掉这个栏目」只是本机的外观偏好。
const (
	ceremonyBucketListName = "人生要有仪式感"
	// ceremonyBucketIcon 是这一栏的固定图标（前端 utils/list-icons.ts 里的 ceremony）
	ceremonyBucketIcon      = "ceremony"
	ceremonyBucketListColor = "rose"
)

// ceremonyFeatureEnabled 读**这个用户自己**的偏好 ceremony_enabled。
// 与信用卡/记事本开关一样做 2 秒进程内缓存（它出现在列表与统计的热路径上）。
var (
	ceremonyFeatureMu    sync.Mutex
	ceremonyFeatureByUID = map[uint]noteFeatureEntry{}
	ceremonyFeatureCache = 2 * time.Second
	ceremonyFeatureMax   = 512
)

func ceremonyFeatureEnabled(db *gorm.DB, userID uint) bool {
	ceremonyFeatureMu.Lock()
	if entry, ok := ceremonyFeatureByUID[userID]; ok && time.Since(entry.at) < ceremonyFeatureCache {
		ceremonyFeatureMu.Unlock()
		return entry.on
	}
	ceremonyFeatureMu.Unlock()

	on := userConfigValue(db, userID, "ceremony_enabled") == "true"

	ceremonyFeatureMu.Lock()
	if len(ceremonyFeatureByUID) >= ceremonyFeatureMax {
		ceremonyFeatureByUID = map[uint]noteFeatureEntry{}
	}
	ceremonyFeatureByUID[userID] = noteFeatureEntry{on: on, at: time.Now()}
	ceremonyFeatureMu.Unlock()
	return on
}

// hiddenCeremonyListIDs 在栏目被后台关掉时返回要摘掉的清单 id。
// 与信用卡同一口径：关掉只影响展示与统计，清单行和条目一条都不删。
func hiddenCeremonyListIDs(db *gorm.DB, userID uint) []uint {
	if ceremonyFeatureEnabled(db, userID) {
		return nil
	}
	var lists []List
	if err := db.Where("user_id = ? AND template = ? AND deleted_at IS NULL", userID, listTemplateCeremony).
		Find(&lists).Error; err != nil {
		return nil
	}
	ids := make([]uint, 0, len(lists))
	for _, l := range lists {
		ids = append(ids, l.ID)
	}
	return ids
}

// resetCeremonyFeatureCache 让下一次读取重新查库（测试与「刚改完配置」的路径用）。
func resetCeremonyFeatureCache() {
	ceremonyFeatureMu.Lock()
	ceremonyFeatureByUID = map[uint]noteFeatureEntry{}
	ceremonyFeatureMu.Unlock()
}

// findCeremonyBucket 取这一栏的清单行（每个用户最多一条）。
func findCeremonyBucket(db *gorm.DB, userID uint, includeDeleted bool) (*List, error) {
	q := db.Where("user_id = ? AND template = ?", userID, listTemplateCeremony)
	if !includeDeleted {
		q = q.Where("deleted_at IS NULL")
	}
	var list List
	if err := q.Order("id ASC").First(&list).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &list, nil
}

// ensureCeremonyBucket 取「人生要有仪式感」这一栏，没有就建一个。
// 与 ensureNoteBucket 同一套：先取现有 → 没有就建 → 并发/重复调用兜底
// （建之前再找一次，包括软删过的先找回，避免出现第二条同名栏目）。
func ensureCeremonyBucket(db *gorm.DB, userID uint) (List, error) {
	var all []List
	if err := db.Where("user_id = ? AND template = ? AND deleted_at IS NULL", userID, listTemplateCeremony).
		Order("id ASC").Find(&all).Error; err != nil {
		return List{}, err
	}
	if len(all) > 0 {
		bucket := all[0]
		// 名字与图标都固定成这一套：老数据/同步过来的行可能不一样，这里顺手纠正。
		updates := map[string]interface{}{}
		if bucket.Name != ceremonyBucketListName {
			updates["name"] = ceremonyBucketListName
			bucket.Name = ceremonyBucketListName
		}
		if bucket.Icon != ceremonyBucketIcon {
			updates["icon"] = ceremonyBucketIcon
			bucket.Icon = ceremonyBucketIcon
		}
		if len(updates) > 0 {
			if err := db.Model(&List{}).Where("id = ?", bucket.ID).Updates(updates).Error; err != nil {
				return List{}, err
			}
		}
		return bucket, nil
	}
	if old, err := findCeremonyBucket(db, userID, true); err != nil {
		return List{}, err
	} else if old != nil {
		if err := db.Model(&List{}).Where("id = ?", old.ID).
			Updates(map[string]interface{}{
				"deleted_at": nil, "name": ceremonyBucketListName,
				"icon": ceremonyBucketIcon, "template": listTemplateCeremony,
			}).Error; err != nil {
			return List{}, err
		}
		old.DeletedAt = nil
		old.Name = ceremonyBucketListName
		old.Icon = ceremonyBucketIcon
		return *old, nil
	}
	var list *List
	{
		var maxPos int
		if err := db.Model(&List{}).Where("user_id = ?", userID).
			Select("COALESCE(MAX(position), 0)").Scan(&maxPos).Error; err != nil {
			return List{}, err
		}
		created := List{
			UserID: userID, Name: ceremonyBucketListName, Color: ceremonyBucketListColor,
			Icon: ceremonyBucketIcon, Position: maxPos + 1, Template: listTemplateCeremony,
		}
		if err := db.Create(&created).Error; err != nil {
			if existing, findErr := findCeremonyBucket(db, userID, false); findErr == nil && existing != nil {
				return *existing, nil
			}
			return List{}, err
		}
		list = &created
	}
	return *list, nil
}
