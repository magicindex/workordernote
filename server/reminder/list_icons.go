package reminder

import (
	"errors"
	"strings"
)

// 清单图标白名单：必须与 web/src/utils/list-icons.ts 里的 LIST_ICONS 一一对应。
//
// 为什么后端也要有一份：`List.Icon` 是用户可控的字符串，API 直接存任意文本的话，
// 前端拿不到对应图形（会静默退回默认图标），用户会以为「选了没生效」。两边一起改，
// 与「日出日落城市」同一套规矩。
var listIconDefs = []struct {
	Key   string
	Label string
}{
	{Key: "list", Label: "清单"},
	{Key: "card", Label: "银行卡"},
	{Key: "notebook", Label: "记事本"},
	{Key: "ceremony", Label: "仪式感"},
	{Key: "cake", Label: "生日"},
	{Key: "check", Label: "待办"},
	{Key: "star", Label: "重要"},
	{Key: "flag", Label: "标记"},
	{Key: "work", Label: "工作"},
	{Key: "meet", Label: "会议"},
	{Key: "study", Label: "学习"},
	{Key: "book", Label: "阅读"},
	{Key: "idea", Label: "灵感"},
	{Key: "home", Label: "家庭"},
	{Key: "money", Label: "财务"},
	{Key: "cart", Label: "购物"},
	{Key: "health", Label: "健康"},
	{Key: "sport", Label: "运动"},
	{Key: "travel", Label: "出行"},
	{Key: "car", Label: "车辆"},
	{Key: "phone", Label: "电话"},
	{Key: "mail", Label: "邮件"},
	{Key: "repair", Label: "维修"},
	{Key: "camera", Label: "影像"},
	{Key: "music", Label: "音乐"},
	{Key: "gift", Label: "礼物"},
	{Key: "pet", Label: "宠物"},
	{Key: "clock", Label: "定时"},
	{Key: "calendar", Label: "日程"},
	{Key: "fire", Label: "紧急"},
}

func validListIcon(key string) bool {
	for _, def := range listIconDefs {
		if def.Key == key {
			return true
		}
	}
	return false
}

// normalizeListIcon 空值或未知值一律落到默认图标，避免存进一个前端画不出来的 key。
func normalizeListIcon(key string) string {
	key = strings.TrimSpace(key)
	if key == "" || !validListIcon(key) {
		return "list"
	}
	return key
}

// 清单 AI 提示词的长度上限（与前端 textarea 的 maxlength 对齐）。
// 它是给模型看的要求，太长会挤掉真正的工作数据，600 字足够写清「怎么分析这一栏」。
const listAIPromptMaxRunes = 600

// normalizeListAIPrompt 清洗用户填的清单 AI 提示词：
// 统一换行（表单里是 \n，老浏览器/剪贴板可能带 \r\n）、去掉首尾空白；
// 超长直接拒绝而不是静默截断——用户写的要求被砍掉一半，比报错更难发现。
func normalizeListAIPrompt(raw string) (string, error) {
	s := strings.ReplaceAll(raw, "\r\n", "\n")
	s = strings.ReplaceAll(s, "\r", "\n")
	s = strings.TrimSpace(s)
	if len([]rune(s)) > listAIPromptMaxRunes {
		return "", errors.New("清单的 AI 提示词最多 600 个字符")
	}
	return s, nil
}
