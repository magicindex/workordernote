#!/bin/sh
# 工作序记 数据体检
# 宿主侧 data 目录是 700（属主 王耀辉），普通账号读不到，
# 因此这里用一个临时容器以 root 只读挂载来检查，不修改任何数据。
#
# 库文件名不再写死：本项目 0.1.1 起把库文件从 reminder.db 改名为
# workordernote.db，写死会在改名后直接报「文件不存在」。这里改成自动识别
# /d/db/*.db，以后再改名也不会失效。
#
# 用法: ./verify-data.sh [数据目录]
set -u
DIR="${1:-/vol1/1000/Docker/reminders/data}"
docker run --rm -i --user root -v "$DIR":/d:ro python:3.12-alpine python - <<'PY'
import sqlite3, os, glob

cands = sorted(glob.glob('/d/db/*.db'))
if not cands:
    raise SystemExit('在 /d/db 下没找到任何 .db 文件；请确认数据目录是否正确')
if len(cands) > 1:
    print('注意：/d/db 下有多个库文件，只体检第一个:', cands)
p = cands[0]

print('数据库:', p, '(%d 字节)' % os.path.getsize(p))
con = sqlite3.connect('file:%s?mode=ro' % p, uri=True)
cur = con.cursor()
print('完整性:', cur.execute('PRAGMA integrity_check').fetchone()[0])
names = [r[0] for r in cur.execute(
    "select name from sqlite_master where type='table' order by name")]
counts = {t: cur.execute('select count(*) from "%s"' % t).fetchone()[0] for t in names}
con.close()
print('表数量:', len(counts))
print()
for t in sorted(counts):
    print('  %-24s %d' % (t, counts[t]))
print()
key = ('users', 'system_configs', 'lists', 'reminders')
print('关键数据:', ', '.join('%s=%s' % (t, counts.get(t)) for t in key))
PY
