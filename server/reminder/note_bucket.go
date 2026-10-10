package reminder

import (
	"errors"
	"sync"
	"time"

	"gorm.io/gorm"
)

// 「随手记事本」是侧栏里与「信用卡账单」并列的另一个**固定栏目**，不是普通清单：
//
//   - 记事（kind=note）一律落到这一栏里（见 ensureNoteBucket 与 createReminder）；
//   - 栏目的显示由个人偏好 notebook_enabled 控制（默认开）；
//   - **关掉只是隐藏**：栏目行从侧栏摘掉，但清单行与记事一条都不删，
//     重新打开偏好就原样回来。
//
// 这里刻意**不删除任何行**：删了会通过双机同步把对端的记事一起删掉，
// 而「关掉这个栏目」是本机的外观偏好，不该影响另一台机器。
const (
	noteBucketListName  = "随手记事本"
	// noteBucketIcon 是记事本栏目的固定图标（前端 utils/list-icons.ts 里的 notebook）
	noteBucketIcon      = "notebook"
	noteBucketListColor = "emerald"
)

// notebookFeatureEnabled 读**这个用户自己**的偏好 notebook_enabled。
//
// 与信用卡栏目一样，这是一个几乎不变的开关，却出现在列表/日历/统计等热路径上，
// 所以按用户做一层很短的进程内缓存：改完最迟 2 秒生效。
var (
	noteFeatureMu    sync.Mutex
	noteFeatureByUID = map[uint]noteFeatureEntry{}
	noteFeatureCache = 2 * time.Second
	noteFeatureMax   = 512
)

type noteFeatureEntry struct {
	on bool
	at time.Time
}

func notebookFeatureEnabled(db *gorm.DB, userID uint) bool {
	noteFeatureMu.Lock()
	if entry, ok := noteFeatureByUID[userID]; ok && time.Since(entry.at) < noteFeatureCache {
		noteFeatureMu.Unlock()
		return entry.on
	}
	noteFeatureMu.Unlock()

	on := userConfigValue(db, userID, "notebook_enabled") == "true"

	noteFeatureMu.Lock()
	if len(noteFeatureByUID) >= noteFeatureMax {
		noteFeatureByUID = map[uint]noteFeatureEntry{}
	}
	noteFeatureByUID[userID] = noteFeatureEntry{on: on, at: time.Now()}
	noteFeatureMu.Unlock()
	return on
}

// resetNoteFeatureCache 让下一次读取重新查库（测试与「刚改完配置」的路径用）。
func resetNoteFeatureCache() {
	noteFeatureMu.Lock()
	noteFeatureByUID = map[uint]noteFeatureEntry{}
	noteFeatureMu.Unlock()
}

// findNoteBucket 取这一栏的清单行（每个用户最多一条）。includeDeleted 用于找回
// 历史上被删掉/改过的记事本；正常查询只认未删除的。
func findNoteBucket(db *gorm.DB, userID uint, includeDeleted bool) (*List, error) {
	q := db.Where("user_id = ? AND template = ?", userID, listTemplateNote)
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

// ensureNoteBucket 取「随手记事本」这一栏，没有就建一个。新建记事与打开侧栏
// 都走这里，所以用户不需要（也无法）自己先建一个清单。
//
// 与 ensureCardBucket 同一套写法：先取现有 → 没有就建 → 并发/重复调用兜底
// （建之前再找一次，包括软删过的先找回，避免出现第二条同名清单）。
func ensureNoteBucket(db *gorm.DB, userID uint) (List, error) {
	var all []List
	if err := db.Where("user_id = ? AND template = ? AND deleted_at IS NULL", userID, listTemplateNote).
		Order("id ASC").Find(&all).Error; err != nil {
		return List{}, err
	}
	if len(all) > 0 {
		bucket := all[0]
		// 名字与图标都固定成「记事本」这一套：图标用笔记本形状，一眼能认出这是记事本
		// （老数据里的记事本可能是默认清单图标，启动后第一次进列表就被纠正过来）。
		updates := map[string]interface{}{}
		if bucket.Name != noteBucketListName {
			updates["name"] = noteBucketListName
			bucket.Name = noteBucketListName
		}
		if bucket.Icon != noteBucketIcon {
			updates["icon"] = noteBucketIcon
			bucket.Icon = noteBucketIcon
		}
		if len(updates) > 0 {
			if err := db.Model(&List{}).Where("id = ?", bucket.ID).Updates(updates).Error; err != nil {
				return List{}, err
			}
		}
		return bucket, nil
	}
	// 曾经被删掉的记事本先找回来，避免反复新建出第二条同名清单。
	if old, err := findNoteBucket(db, userID, true); err != nil {
		return List{}, err
	} else if old != nil {
		if err := db.Model(&List{}).Where("id = ?", old.ID).
			Updates(map[string]interface{}{"deleted_at": nil, "name": noteBucketListName, "icon": noteBucketIcon, "template": listTemplateNote}).Error; err != nil {
			return List{}, err
		}
		old.DeletedAt = nil
		old.Name = noteBucketListName
		old.Icon = noteBucketIcon
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
			UserID: userID, Name: noteBucketListName, Color: noteBucketListColor,
			Icon: noteBucketIcon, Position: maxPos + 1, Template: listTemplateNote,
		}
		if err := db.Create(&created).Error; err != nil {
			// 并发下可能已经有另一个请求建好了：再找一次，有就用它。
			if existing, findErr := findNoteBucket(db, userID, false); findErr == nil && existing != nil {
				return *existing, nil
			}
			return List{}, err
		}
		list = &created
	}
	return *list, nil
}
