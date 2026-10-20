package reminder

import "errors"

// 仪式感卡片的**过渡色白名单**（用户 2026-10-11 要求：卡片适配多种过渡色、可自行选择）。
//
// 这里只做「这个色名认不认」的校验，具体渐变两端颜色在前端
// web/src/utils/card-accents.ts 里（两边一一对应，改色名要一起改）。
// 空字符串表示用默认色（前端把空当默认档）。
var supportedAccents = map[string]bool{
	"rose": true, "amber": true, "orange": true, "emerald": true,
	"teal": true, "sky": true, "indigo": true, "violet": true,
	"fuchsia": true, "slate": true,
	// 金属四档（用户 2026-10-19）。
	"silver": true, "golden": true, "bronze": true, "iron": true,
	// 浅色系（卡面浅底深字，倒计时块仍用配套浓色）。
	"light-sky": true, "light-violet": true, "light-rose": true,
	"light-amber": true, "light-emerald": true, "light-teal": true,
}

// validateAccent 校验过渡色色名；空值表示「不设置/清除」，由调用方决定语义。
func validateAccent(accent string) error {
	if accent == "" || supportedAccents[accent] {
		return nil
	}
	return errors.New("卡片过渡色无效，可选：rose / amber / orange / emerald / teal / sky / indigo / violet / fuchsia / slate，或浅色 light-sky / light-violet / light-rose / light-amber / light-emerald / light-teal")
}
