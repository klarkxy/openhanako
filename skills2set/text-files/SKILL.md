---
name: text-files
description: "处理普通文本文件的读取、创建、更新、追加和删除。只要用户要对 .txt/.md/.log/.csv/.json/.yaml/.yml/.ini/.sh/.py/.ts/.js 等纯文本文件做确定性 CRUD 编辑、字面替换、锚点插入或片段提取，就使用这个技能；直接调用内置 Node 工具，不要临时手写文件操作脚本。"
compatibility: "仅依赖 Node.js 20+ 标准库，默认使用 UTF-8。"
metadata:
  default-enabled: true
---

# 文本文件工具

此技能用于普通文本文件，不用于 PDF、Word、Excel 或其他二进制格式。

## 工作流

1. 先判断目标是不是纯文本文件。
2. 先读后改。
3. 读取时使用 `scripts/text_file.js read`。
4. 创建新文件时使用 `create`。
5. 更新现有文件时使用 `write`、`append`、`replace` 或 `insert`。
6. 删除文件时使用 `delete`。
7. 修改后重新读取确认结果。

## 读取

```bash
node skills2set/text-files/scripts/text_file.js read path/to/file.txt
node skills2set/text-files/scripts/text_file.js read path/to/file.txt --start-line 20 --end-line 50 --number-lines
node skills2set/text-files/scripts/text_file.js read path/to/file.txt --max-chars 12000 --json
```

要点：

- `--number-lines` 会输出原始行号，适合定位修改。
- `--json` 适合需要机器读取摘要时使用。
- 默认使用 UTF-8；如果源文件是其他编码，再显式传 `--encoding`。

## 创建与覆盖

```bash
node skills2set/text-files/scripts/text_file.js create path/to/new.txt --text "hello"
node skills2set/text-files/scripts/text_file.js create path/to/new.txt --text-file draft.txt
node skills2set/text-files/scripts/text_file.js write path/to/existing.txt --text-file revised.txt
```

要点：

- `create` 只用于新文件，若文件已存在会失败。
- `write` 会直接覆盖整份文件，用于整文件重写。
- 长文本优先用 `--text-file`，避免在命令行里手工转义。

## 更新

```bash
node skills2set/text-files/scripts/text_file.js append path/to/file.txt --text "\nextra line"
node skills2set/text-files/scripts/text_file.js replace path/to/file.txt --find "old" --replace "new"
node skills2set/text-files/scripts/text_file.js replace path/to/file.txt --find-file old.txt --replace-file new.txt --regex --ignore-case
node skills2set/text-files/scripts/text_file.js insert path/to/file.txt --anchor "section title" --text "\nNew paragraph\n" --after
```

要点：

- `append` 是原样追加；要换行时，把换行一并放进追加文本里。
- `replace` 默认是字面替换；只有在需要模式匹配时才加 `--regex`。
- `insert` 以锚点字符串定位，默认插在锚点前；加 `--after` 则插在后面。
- 长锚点或长替换片段也优先用 `--find-file`、`--replace-file` 和 `--text-file`。

## 删除

```bash
node skills2set/text-files/scripts/text_file.js delete path/to/file.txt
node skills2set/text-files/scripts/text_file.js delete path/to/file.txt --force
```

要点：

- `delete` 只删除文件，不处理目录。
- `--force` 会在文件已经不存在时直接视为成功。
- `replace` 和 `insert` 的匹配可以用 `--regex` 或 `--ignore-case` 控制，但替换文本本身仍然按字面插入。

## 验证

每次修改后：

1. 重新读取目标文件。
2. 检查修改是否命中预期位置。
3. 确认无关内容没有被误改。
4. 如果是批量文本处理，优先用多个小命令串起来，而不是先写 Python 代码再跑。
