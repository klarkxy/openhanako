---
name: office-documents
description: "当用户要打开、读取、检查、理解、总结、分析、从 PDF、DOCX、XLSX、XLSM 或 PPTX 文件中提取表格/文本、修改、更新、修复、拆分、合并、旋转或转换信息时使用，包括用户顺带提到 Word、Excel、PowerPoint、电子表格、演示文稿、Office 文档或 PDF 的情况。读取或修改 PDF、Word、Excel、PPT 文件时必须使用。"
compatibility: "使用内置的 Python 脚本。可选库可提升覆盖率：markitdown、python-docx、openpyxl、python-pptx、pdfplumber、pypdf。无需 OfficeCLI、Microsoft Office、LibreOffice 或 GUI 查看器。"
metadata:
  default-enabled: true
---

# Office 文档

此技能用于处理文档文件，而不是搭建 Office 查看器。目标是让代理通过确定性的脚本理解并安全地修改文件。

支持的格式：

- PDF：`.pdf`
- Word：`.docx`
- Excel：`.xlsx`、`.xlsm`
- PowerPoint：`.pptx`

不要把 Anthropic/Claude 的文档技能当作来源材料。这个技能是独立编写的，依赖宽松许可的开源库或直接的 OOXML 解析。修改依赖前请先查看 `references/licenses.md`。

## 核心工作流

1. 根据扩展名和用户目标，先判断文件类型。
2. 先读后改。修改前一定要先检查源文件。
3. 读取时运行 `scripts/read_document.py`。
4. 编辑时，先写一个小型 JSON 操作文件，再运行对应的编辑脚本。
5. 除非用户明确要求覆盖原文件，否则把编辑结果保存到新输出文件。
6. 再用 `scripts/read_document.py` 读取输出文件，确认修改是否符合要求。
7. 如果请求超出支持范围，要明确说明并停止。

## 读取

所有支持格式都使用 `read_document.py`：

```bash
python3 skills2set/office-documents/scripts/read_document.py input.docx --format markdown
python3 skills2set/office-documents/scripts/read_document.py input.xlsx --format json --output summary.json
python3 skills2set/office-documents/scripts/read_document.py input.pdf --max-chars 120000
```

行为：

- 如果可用，优先尝试 MarkItDown。
- 如果 MarkItDown 不可用，则对 DOCX、XLSX 和 PPTX 使用直接的 OOXML 读取器。
- PDF 文本提取先尝试 pdfplumber，再尝试 pypdf。
- 当所需 PDF 库不可用或文件不受支持时，会返回清晰的 JSON 错误。

对于大文档，先读到足够理解结构，再按工作表、幻灯片、页面、标题或搜索文本缩小范围。

## 编辑

使用 JSON 操作。每个操作都要明确，且足够小，便于验证。

### DOCX

```bash
python3 skills2set/office-documents/scripts/edit_docx.py input.docx output.docx --ops ops.json
```

支持的操作：

```json
[
  { "op": "replace_text", "find": "old text", "replace": "new text" },
  { "op": "append_paragraph", "text": "New paragraph" },
  { "op": "add_table", "rows": [["Name", "Value"], ["A", "10"]] }
]
```

安全的文本更新使用 `replace_text`。`append_paragraph` 和 `add_table` 需要 `python-docx`。

### XLSX

```bash
python3 skills2set/office-documents/scripts/edit_xlsx.py input.xlsx output.xlsx --ops ops.json
```

支持的操作：

```json
[
  { "op": "set_cell", "sheet": "Sheet1", "cell": "B2", "value": "Approved" },
  { "op": "set_formula", "sheet": "Sheet1", "cell": "C10", "formula": "=SUM(C2:C9)" },
  { "op": "append_row", "sheet": "Sheet1", "values": ["Total", 1200] },
  { "op": "add_sheet", "name": "Summary" },
  { "op": "rename_sheet", "sheet": "Sheet1", "name": "Data" },
  { "op": "set_style", "sheet": "Data", "cell": "A1", "bold": true, "font_color": "FFFFFF", "fill_color": "1F4E79" }
]
```

XLSX 编辑需要 `openpyxl`。除非用户要求替换，否则要保留公式。

### PPTX

```bash
python3 skills2set/office-documents/scripts/edit_pptx.py input.pptx output.pptx --ops ops.json
```

支持的操作：

```json
[
  { "op": "replace_text", "find": "Q1", "replace": "Q2" },
  { "op": "set_shape_text", "slide": 1, "shape_index": 2, "text": "Updated title" },
  { "op": "add_textbox", "slide": 3, "text": "Speaker note", "left": 1, "top": 1, "width": 8, "height": 1 }
]
```

直接的 OOXML 文本更新使用 `replace_text`。形状定位和文本框需要 `python-pptx`。

### PDF

```bash
python3 skills2set/office-documents/scripts/edit_pdf.py input.pdf output.pdf --ops ops.json
```

支持的操作：

```json
[
  { "op": "rotate_pages", "pages": "1,3-4", "degrees": 90 },
  { "op": "extract_pages", "pages": "1-2,5" },
  { "op": "delete_pages", "pages": "7" },
  { "op": "merge", "inputs": ["a.pdf", "b.pdf"] },
  { "op": "set_metadata", "metadata": { "/Title": "Updated document" } }
]
```

PDF 编辑需要 `pypdf`。不要声称支持任意 PDF 文本替换。PDF 文本是绘制指令，不是普通文档文本。

## 验证

每次编辑后：

1. 确认输出文件存在且非空。
2. 用 `read_document.py` 读取输出文件。
3. 检查请求的内容是否已改变，以及无关内容是否仍然完好。
4. 报告任何限制、依赖失败或部分编辑情况。

对于 XLSX 公式，openpyxl 会保留公式，但不会计算它们。如果计算后的值很重要，而本地又没有可用的重算引擎，就要说明公式已经写入，但本地没有重新计算。

## 不支持或需要谨慎的情况

当请求需要真实的 Office 渲染器或高级文档引擎时，要明确说明：

- 像素级布局修复。
- 在没有 OCR 引擎或模型时，对扫描版 PDF 做 OCR。
- 任意 PDF 文本替换。
- 宏、VBA、加密文件、密码保护文件。
- 复杂的 PowerPoint 动画、过渡、SmartArt、嵌入媒体、OLE 对象。
- Excel 数据透视表制作、切片器、外部链接、宏。
- 与 Microsoft Word 完全一致的修订/跟踪更改效果。

如果用户需要这些能力中的任意一种，要解释具体限制，并建议最小且安全的替代方案。

## 参考

只在需要时读取相关参考文件：

- `references/docx.md`：Word 细节。
- `references/xlsx.md`：电子表格细节。
- `references/pptx.md`：PowerPoint 细节。
- `references/pdf.md`：PDF 细节。
- `references/licenses.md`：许可和依赖约束。
