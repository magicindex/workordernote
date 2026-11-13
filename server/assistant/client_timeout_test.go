package assistant

import (
	"errors"
	"net/url"
	"os"
	"strings"
	"testing"
)

// 超时错误要把**配置的超时秒数**写进文案，并提示去后台调大（用户 2026-11-13：
// 对着「Request failed with status code 502」不知道卡在哪；实测 qwen3:8b 写周报 90+ 秒，
// 默认 60 秒会超时）。
func TestConnectionErrorTextMentionsTimeoutSeconds(t *testing.T) {
	timeoutErr := &url.Error{Op: "Post", URL: "http://x/v1", Err: os.ErrDeadlineExceeded}
	text := connectionErrorText("http://192.168.3.201:11434/v1", 180, timeoutErr)
	if !strings.Contains(text, "180 秒") {
		t.Fatalf("超时文案应带出配置的秒数，实际 %q", text)
	}
	if !strings.Contains(text, "调大超时时间") {
		t.Fatalf("超时文案应提示去后台调大超时，实际 %q", text)
	}
	// 非超时错误仍说「无法连接」
	connErr := errors.New("connection refused")
	if got := connectionErrorText("http://x/v1", 60, connErr); !strings.Contains(got, "无法连接") {
		t.Fatalf("连接失败文案不对：%q", got)
	}
}
