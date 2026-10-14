package qrcode

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/skip2/go-qrcode"
	"gorm.io/gorm"
	"smallgo/server/apps"
	"smallgo/server/database"
	"smallgo/server/response"
)

// QRCodeStat is a GORM model contributed by this app to AutoMigrate. It
// demonstrates the database.RegisterModels extension point: app-owned
// tables land on the same startup pass as the framework's core models.
type QRCodeStat struct {
	ID        uint   `gorm:"primarykey"`
	Content   string `gorm:"index;not null"`
	Size      int
	CreatedAt time.Time `gorm:"index"`
}

func init() {
	database.RegisterModels(&QRCodeStat{})

	// 这里原本有一个 0.0.1 的一次性迁移（继承自上游模板示例），会在表为空时
	// 种入一条内容为上游作者官网的二维码。作为衍生版本已移除该默认种子：
	// 不再向用户预置任何指向第三方站点的内容，二维码由用户在「二维码」应用里自建。
	// （已装实例中早先种入的那条记录不会被自动删除，避免误删用户数据/自建内容。）

	apps.Register(apps.App{
		Name:        "qrcode",
		DisplayName: "二维码",
		Icon:        "qr",
		RoutePrefix: "/qrcode",
		NavPosition: 200,
		Setup:       setupRoutes,
	})
}

func setupRoutes(api *gin.RouterGroup, db *gorm.DB) {
	api.GET("/qrcode", HandleQRCode(db))
}

// HandleQRCode returns a PNG QR code for the `content` query param. The
// `size` parameter is capped at maxSizePx so a hostile client can't pin
// the CPU/memory by requesting `?size=100000`.
func HandleQRCode(db *gorm.DB) gin.HandlerFunc {
	const (
		defaultSizePx   = 256
		maxSizePx       = 1024
		maxContentBytes = 2048
	)
	return func(c *gin.Context) {
		content := c.Query("content")
		if content == "" {
			response.ErrorBadRequest(c, "请输入内容")
			return
		}
		if len(content) > maxContentBytes {
			response.ErrorBadRequest(c, "内容不能超过 2048 字节")
			return
		}

		size := defaultSizePx
		if s, err := strconv.Atoi(c.Query("size")); err == nil {
			switch {
			case s <= 0:
			case s > maxSizePx:
				size = maxSizePx
			default:
				size = s
			}
		}

		png, err := qrcode.Encode(content, qrcode.Medium, size)
		if err != nil {
			response.ErrorInternal(c, "生成二维码失败")
			return
		}

		// Best-effort stat row — a failed insert must NOT fail the request.
		_ = db.Create(&QRCodeStat{
			Content:   content,
			Size:      size,
			CreatedAt: time.Now(),
		}).Error

		c.Data(http.StatusOK, "image/png", png)
	}
}
