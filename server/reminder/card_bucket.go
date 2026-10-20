package reminder

import (
	"errors"
	"sync"
	"time"

	"gorm.io/gorm"

	"smallgo/server/sysconfig"
)

// 「信用卡账单」是侧栏里一个**固定栏目**，不是普通清单：
//
//   - 用户不再在「新建清单」里选模板，新建的卡片一律落到这一栏里（见 ensureCardBucket）；
//   - 栏目的显示由后台偏好 credit_card_enabled 控制（默认开）；
//   - **关掉只是隐藏**：栏目行、卡片页入口、以及卡片自动生成的账单日/还款日提醒
//     都从清单/日历/统计里摘掉，但清单行、卡片、账单金额与还款记录一条都不删，
//     重新打开偏好就原样回来。
//
// 这里刻意**不删除任何行**：删了会通过双机同步把对端的同一栏一起删掉，
// 而「关掉这个栏目」是本机的外观偏好，不该影响另一台机器。
const (
	cardBucketListName  = "信用卡账单"
	cardBucketListColor = "blue"
	cardBucketListIcon  = "card"
)

// creditCardFeatureEnabled 读**这个用户自己**的偏好 credit_card_enabled。
//
// 「信用卡账单」不是所有人都用，所以它是个人偏好（ScopeUser，默认关）而不是系统开关。
// 这个值在 /summary、/items、/calendar 这些热路径上都要看，而它又是一个几乎不变的
// 开关，所以按用户做一层很短的进程内缓存：改完最迟 2 秒生效（前端的侧栏是保存后
// 立刻更新的，感知不到）。这样普通路径上不额外查库，也不会把 /summary 的固定查询
// 次数（见 performance_test.go）撑大。
var (
	cardFeatureMu    sync.Mutex
	cardFeatureByUID = map[uint]cardFeatureEntry{}
	cardFeatureCache = 2 * time.Second
	cardFeatureMax   = 512 // 缓存条目上限，超过就整体清一次（单机用户数远小于它）
)

type cardFeatureEntry struct {
	on     bool
	hidden []uint // 栏目关掉时要摘掉的清单 id；开着时是 nil
	at     time.Time
}

// cardFeatureState 一次算出「这个用户开没开」以及「关着的话要摘掉哪些清单」，
// 两者共用同一份缓存：否则关着栏目的用户每读一次列表/日历/统计都要多查两次库，
// 把「固定查询次数」的保证打穿（见 performance_test.go）。
func cardFeatureState(db *gorm.DB, userID uint) (bool, []uint) {
	cardFeatureMu.Lock()
	if entry, ok := cardFeatureByUID[userID]; ok && time.Since(entry.at) < cardFeatureCache {
		cardFeatureMu.Unlock()
		return entry.on, entry.hidden
	}
	cardFeatureMu.Unlock()

	on := userConfigValue(db, userID, "credit_card_enabled") == "true"
	var hidden []uint
	if !on {
		// 只有关掉时才需要知道要摘哪些清单（开着的话调用点根本不用过滤）。
		var lists []List
		if err := db.Where("user_id = ? AND template = ? AND deleted_at IS NULL", userID, listTemplateCard).
			Find(&lists).Error; err == nil {
			for _, l := range lists {
				hidden = append(hidden, l.ID)
			}
		}
	}

	cardFeatureMu.Lock()
	if len(cardFeatureByUID) >= cardFeatureMax {
		cardFeatureByUID = map[uint]cardFeatureEntry{}
	}
	cardFeatureByUID[userID] = cardFeatureEntry{on: on, hidden: hidden, at: time.Now()}
	cardFeatureMu.Unlock()
	return on, hidden
}

func creditCardFeatureEnabled(db *gorm.DB, userID uint) bool {
	on, _ := cardFeatureState(db, userID)
	return on
}

// userConfigValue 取某个用户自己的配置值；没写过就用注册表里的默认值。
func userConfigValue(db *gorm.DB, userID uint, key string) string {
	value := ""
	if def, ok := sysconfig.GetConfigDef(key); ok {
		value = def.Default
	}
	if v, err := sysconfig.GetConfig(db, key, userID); err == nil && v != "" {
		value = v
	}
	return value
}

// resetCardFeatureCache 让下一次读取重新查库（测试与「刚改完配置」的路径用）。
func resetCardFeatureCache() {
	cardFeatureMu.Lock()
	cardFeatureByUID = map[uint]cardFeatureEntry{}
	cardFeatureMu.Unlock()
}

// findCardBucket 取这一栏的清单行（每个用户最多一条）。includeDeleted 用于找回
// 历史上被改过名/动过的卡包；正常查询只认未删除的。
func findCardBucket(db *gorm.DB, userID uint, includeDeleted bool) (*List, error) {
	q := db.Where("user_id = ? AND template = ?", userID, listTemplateCard)
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

// ensureCardBucket 取「信用卡账单」这一栏，没有就建一个。新建卡片、打开栏目页
// 都走这里，所以用户不需要（也无法）自己先建一个清单。
//
// **兼容老数据**：0.13.0 之前「信用卡」是普通清单的一种模板，用户可能自己建过
// 一个甚至几个（名字还各不相同，例如「招商银行信用卡」）。这里把它们并成这一栏：
// 最老的那条当栏目，其余清单里的卡片挪过来、那些清单软删掉，并把挪过来的卡片
// 的提醒重建到栏目下——否则用户会看到「卡片页里没有我以前的卡」。
func ensureCardBucket(db *gorm.DB, userID uint) (List, error) {
	var all []List
	if err := db.Where("user_id = ? AND template = ? AND deleted_at IS NULL", userID, listTemplateCard).
		Order("id ASC").Find(&all).Error; err != nil {
		return List{}, err
	}
	if len(all) > 0 {
		bucket := all[0]
		if err := adoptLegacyCardLists(db, userID, bucket, all[1:]); err != nil {
			return List{}, err
		}
		if bucket.Name != cardBucketListName {
			if err := db.Model(&List{}).Where("id = ?", bucket.ID).
				Update("name", cardBucketListName).Error; err != nil {
				return List{}, err
			}
			bucket.Name = cardBucketListName
		}
		return bucket, nil
	}
	// 曾经被删掉的卡包先找回来，避免反复新建出第二条同名清单。
	if old, err := findCardBucket(db, userID, true); err != nil {
		return List{}, err
	} else if old != nil {
		if err := db.Model(&List{}).Where("id = ?", old.ID).
			Updates(map[string]interface{}{"deleted_at": nil, "name": cardBucketListName, "template": listTemplateCard}).Error; err != nil {
			return List{}, err
		}
		old.DeletedAt = nil
		old.Name = cardBucketListName
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
			UserID: userID, Name: cardBucketListName, Color: cardBucketListColor,
			Icon: cardBucketListIcon, Position: maxPos + 1, Template: listTemplateCard,
		}
		if err := db.Create(&created).Error; err != nil {
			return List{}, err
		}
		list = &created
	}
	return *list, nil
}

// adoptLegacyCardLists 把老的多条「信用卡清单」并入栏目：卡片挪过去、提醒重建、
// 多余清单软删。没有多余清单时是一次空操作。
func adoptLegacyCardLists(db *gorm.DB, userID uint, bucket List, extras []List) error {
	if len(extras) == 0 {
		return nil
	}
	now := time.Now()
	var moved []Card
	for _, extra := range extras {
		var cards []Card
		if err := db.Where("user_id = ? AND list_id = ? AND deleted_at IS NULL", userID, extra.ID).
			Find(&cards).Error; err != nil {
			return err
		}
		for i := range cards {
			if err := db.Model(&Card{}).Where("id = ?", cards[i].ID).
				Update("list_id", bucket.ID).Error; err != nil {
				return err
			}
			cards[i].ListID = bucket.ID
		}
		moved = append(moved, cards...)
		// 旧清单下残留的提醒（卡片提醒或手建的）一并收走：软删，卡片提醒随后重建。
		if err := db.Model(&Reminder{}).
			Where("user_id = ? AND list_id = ? AND deleted_at IS NULL", userID, extra.ID).
			Updates(map[string]interface{}{"deleted_at": now, "updated_at": now}).Error; err != nil {
			return err
		}
		if err := db.Model(&List{}).Where("id = ?", extra.ID).
			Updates(map[string]interface{}{"deleted_at": now, "updated_at": now}).Error; err != nil {
			return err
		}
	}
	// 挪过来的卡片重建提醒（generateCardPlan 会先把这张卡的老提醒软删掉，
	// 新提醒就挂在新栏目下了）。
	for i := range moved {
		if _, err := generateCardPlan(db, &moved[i], now); err != nil {
			return err
		}
	}
	return nil
}

// hiddenCardListIDs 在栏目被后台关掉时返回要摘掉的清单 id。
// 开着的时候返回 nil，所有调用点都是零成本。
//
// 返回**全部** template=credit_card 的清单（老数据可能不止一条，见 adoptLegacyCardLists），
// 否则关掉栏目后旧清单里的卡片提醒还会留在列表与日历里。
func hiddenCardListIDs(db *gorm.DB, userID uint) []uint {
	_, hidden := cardFeatureState(db, userID)
	return hidden
}

// excludeHiddenCardReminders 把卡片生成的提醒从查询里摘掉（只在栏目关闭时生效）。
func excludeHiddenCardReminders(q *gorm.DB, hidden []uint) *gorm.DB {
	if len(hidden) == 0 {
		return q
	}
	return q.Where("list_id NOT IN ?", hidden)
}

// excludeHiddenCardCompletions 同理，摘的是「卡片提醒的完成记录」。
func excludeHiddenCardCompletions(q *gorm.DB, db *gorm.DB, hidden []uint) *gorm.DB {
	if len(hidden) == 0 {
		return q
	}
	return q.Where("reminder_id NOT IN (?)",
		db.Model(&Reminder{}).Select("id").Where("list_id IN ?", hidden))
}
