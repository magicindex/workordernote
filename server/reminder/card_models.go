package reminder

import (
	"strings"
	"time"
)

// 清单模板：general（普通）、credit_card（信用卡栏目，里面放卡片实体）
// 或 notebook（记事本栏目，里面放 kind=note 的记事）。
//
// 后两者都是侧栏里的**固定系统栏目**：不在「新建清单」里选，也不混进「我的清单」，
// 各自的显示由个人偏好控制（见 card_bucket.go / note_bucket.go）。
const (
	listTemplateGeneral  = "general"
	listTemplateCard     = "credit_card"
	listTemplateNote     = "notebook"
	listTemplateCeremony = "ceremony"
)

// normalizeListTemplate 把「系统栏目」的模板名规范化。
//
// 必须把**所有**系统栏目都认出来：同步过来的清单如果模板名不被识别，就会退化成
// 普通清单 —— 对端再按模板查找自己的栏目时会找不到，于是**各自再建一个**，两边都
// 冒出重复的「记事本」（实测：0.15.0 上线后 201 有 3 个、200 有 4 个记事本）。
func normalizeListTemplate(t string) string {
	trimmed := strings.TrimSpace(t)
	if strings.EqualFold(trimmed, listTemplateCard) {
		return listTemplateCard
	}
	if strings.EqualFold(trimmed, listTemplateNote) {
		return listTemplateNote
	}
	if strings.EqualFold(trimmed, listTemplateCeremony) {
		return listTemplateCeremony
	}
	return listTemplateGeneral
}

// 信用卡：挂在「信用卡」清单下的一张卡（一个清单可以有多张）。
//
// 与旧版（卡片信息直接挂在清单上、清单=一张卡）的区别：卡片是独立实体，
// 因此可以一个清单放多张卡；同时每张卡多了额度/提前提醒天数/卡面配色，
// 以及按「账单期」记录的金额与还款状态（见 CardStatement）。
type Card struct {
	ID      uint   `gorm:"primarykey" json:"id"`
	SyncUID string `gorm:"size:40;index" json:"-"`
	UserID  uint   `gorm:"not null;index" json:"-"`
	ListID  uint   `gorm:"not null;index" json:"list_id"`

	Name   string `gorm:"size:60" json:"name"`   // 卡名（如 经典白）
	Bank   string `gorm:"size:60" json:"bank"`   // 银行
	No     string `gorm:"size:32" json:"no"`     // 卡号（可只填尾号，界面只显示尾号）
	Holder string `gorm:"size:60" json:"holder"` // 持卡人（可选）
	// 额度与金额一律用「分」存：浮点数做钱的加法会出现 0.1+0.2 这类误差。
	Limit int64 `json:"limit_cents"`

	StatementDay int `json:"statement_day"` // 每月账单日 1–31
	DueDay       int `json:"due_day"`       // 每月还款日 1–31
	// AdvanceDays：还款日前几天额外提醒一次（0 = 不提醒）。
	// default:0 而不是 3：GORM 会跳过「带 default 标签的零值字段」，
	// 用 3 做默认值会让「明确填 0」被数据库改回 3（这个坑踩过一次）。
	AdvanceDays int  `gorm:"not null;default:0" json:"advance_days"`
	AutoRepeat  bool `gorm:"not null;default:false" json:"auto_repeat"`

	Notes    string `gorm:"type:text" json:"notes"`
	Color    string `gorm:"size:16;not null;default:blue" json:"color"` // 卡面配色名
	Position int    `gorm:"not null;default:0" json:"position"`

	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
	DeletedAt *time.Time `gorm:"index" json:"-"`
}

// CardStatement 是某张卡「某一期」的账单：金额与有没有还。
//
// 账单期按账单日的年月记（Period = "2026-10"），账单日与还款日的具体日期
// 在生成这一期时算好存下来——这样以后改卡的账单日，历史期数不会被追溯改写。
type CardStatement struct {
	ID      uint   `gorm:"primarykey" json:"id"`
	SyncUID string `gorm:"size:40;index" json:"-"`
	UserID  uint   `gorm:"not null;index" json:"-"`
	CardID  uint   `gorm:"not null;index:idx_card_statements_card_period" json:"card_id"`
	Period  string `gorm:"size:7;not null;index:idx_card_statements_card_period" json:"period"`

	StatementDate time.Time `json:"statement_date"`
	DueDate       time.Time `json:"due_date"`

	Amount  int64 `json:"amount_cents"`  // 本期应还（0 表示还没填）
	Minimum int64 `json:"minimum_cents"` // 最低还款额（可选）

	PaidAt     *time.Time `json:"paid_at,omitempty"`
	PaidAmount int64      `json:"paid_amount_cents"`
	Note       string     `gorm:"type:text" json:"note"`

	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
	DeletedAt *time.Time `gorm:"index" json:"-"`
}

// CardSummary 是「下一步」摘要：下一次账单日/还款日、倒计时、免息期、提前提醒日。
type CardSummary struct {
	StatementDate   string `json:"statement_date"`
	DueDate         string `json:"due_date"`
	DaysToStatement int    `json:"days_to_statement"`
	DaysToDue       int    `json:"days_to_due"`
	GraceDays       int    `json:"grace_days"`
	AdvanceDate     string `json:"advance_date,omitempty"` // 提前提醒那天
	AdvanceDays     int    `json:"advance_days"`
}

// CardDTO 是给前端的卡片：卡片信息 + 摘要 + 本期账单（可能还没填金额）。
type CardDTO struct {
	Card
	Summary *CardSummary      `json:"summary"`
	Current *CardStatementDTO `json:"current"`
	// UnpaidTotal：还没还的期数金额合计（含之前漏还的），前端显示「待还合计」。
	UnpaidTotal int64 `json:"unpaid_total_cents"`
	UnpaidCount int64 `json:"unpaid_count"`
	// LastPaid：最近一次「已还款」的那一期。当期已经推进到下一期之后，卡片上仍要能看到
	// 「本期已还 ¥x」并提供「撤销已还」——否则点了还款就没法撤销了。
	LastPaid *CardStatementDTO `json:"last_paid,omitempty"`
}

// CardStatementDTO 是账单期 + 它属于哪张卡（排期列表里要显示卡名）。
type CardStatementDTO struct {
	CardStatement
	CardName string `json:"card_name,omitempty"`
	Bank     string `json:"bank,omitempty"`
	Color    string `json:"color,omitempty"`
	Overdue  bool   `json:"overdue"`
}

// CardPeriod 是「还款计划」里的一期（可能还没有对应的账单记录）。
type CardPeriod struct {
	Period        string `json:"period"`
	StatementDate string `json:"statement_date"`
	DueDate       string `json:"due_date"`
	Amount        int64  `json:"amount_cents"`
	Minimum       int64  `json:"minimum_cents"`
	Paid          bool   `json:"paid"`
	PaidAt        string `json:"paid_at,omitempty"`
	PaidAmount    int64  `json:"paid_amount_cents"`
	Overdue       bool   `json:"overdue"`
	Current       bool   `json:"current"`
	Note          string `json:"note,omitempty"`
}
