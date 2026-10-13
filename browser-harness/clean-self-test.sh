#!/bin/bash
# 清理自检残留（用例被中途 Ctrl-C / kill 时会留下「自检…」数据）。
#
# 用法：
#   bash clean-self-test.sh http://127.0.0.1:8908 [数据库所在目录]
#
# 做两件事：
#   1. 走 API 删掉名字里带「自检」的卡片、清单与提醒（需要管理员账号，默认取环境变量里的同一套）；
#   2. 如果给了数据目录（本机实例），再直接清掉 completions 里带「自检」的历史行 ——
#      完成记录是只增不删的历史表，没有删除接口（见 deployment-README 的踩坑记录）。
set -uo pipefail
BASE=${1:-http://127.0.0.1:8908}
DATA_DIR=${2:-}
USER_NAME=${APP_USER:-王耀辉}
PASS=${APP_PASS:-'Wyh!1984yelq.'}

TOK=$(curl -s -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d "{\"username\":\"$USER_NAME\",\"password\":\"$PASS\"}" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['token'])")
[ -z "$TOK" ] && { echo "登录失败"; exit 1; }
AUTH="Authorization: Bearer $TOK"

echo "== 删除带「自检」的卡片 =="
curl -s -H "$AUTH" "$BASE/api/reminder/cards" | python3 -c "
import sys,json
d=json.load(sys.stdin)['data']
print('\n'.join(str(c['id']) for c in d if '自检' in (c.get('name','')+c.get('bank',''))))
" | while read -r id; do
  [ -n "$id" ] && curl -s -X DELETE -H "$AUTH" "$BASE/api/reminder/cards/$id" >/dev/null && echo "  删除卡片 $id"
done

echo "== 删除带「自检」的提醒 =="
curl -s -H "$AUTH" "$BASE/api/reminder/items?view=all&status=all" | python3 -c "
import sys,json
d=json.load(sys.stdin)['data']
rows=d.get('items') if isinstance(d,dict) else d
print('\n'.join(str(i['id']) for i in rows if '自检' in str(i.get('title',''))))
" | while read -r id; do
  [ -n "$id" ] && curl -s -X DELETE -H "$AUTH" "$BASE/api/reminder/items/$id" >/dev/null && echo "  删除提醒 $id"
done

echo "== 删除带「自检」的清单 =="
curl -s -H "$AUTH" "$BASE/api/reminder/lists" | python3 -c "
import sys,json
d=json.load(sys.stdin)['data']
print('\n'.join(str(l['id']) for l in d if '自检' in l['name']))
" | while read -r id; do
  [ -n "$id" ] && curl -s -X DELETE -H "$AUTH" "$BASE/api/reminder/lists/$id" >/dev/null && echo "  删除清单 $id"
done

if [ -n "$DATA_DIR" ]; then
  echo "== 清 completions 里的自检历史（$DATA_DIR）=="
  python3 - "$DATA_DIR/db/workordernote.db" <<'PYEOF'
import sqlite3, sys
db = sys.argv[1]
c = sqlite3.connect(db)
rows = c.execute("SELECT COUNT(*) FROM completions WHERE title_snapshot LIKE '%自检%'").fetchone()[0]
c.execute("DELETE FROM completions WHERE title_snapshot LIKE '%自检%'")
c.commit()
print(f"  删除 {rows} 条完成记录；剩余 {c.execute('SELECT COUNT(*) FROM completions').fetchone()[0]} 条")
c.close()
PYEOF
fi

echo "== 复查 =="
curl -s -H "$AUTH" "$BASE/api/reminder/items?view=all&status=all" | python3 -c "
import sys,json
d=json.load(sys.stdin)['data']
rows=d.get('items') if isinstance(d,dict) else d
print('  条目', len(rows), '｜含自检', len([i for i in rows if '自检' in str(i.get('title',''))]))"
