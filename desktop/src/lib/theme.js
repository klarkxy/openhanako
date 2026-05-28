/**
 * lib/theme.js — Vite 构建时的模块入口桩
 *
 * 实际主题逻辑在 shared/theme.ts 中。
 * 生产构建（build:theme）会以 IIFE 格式将 shared/theme.ts
 * 独立打包到 dist-renderer/lib/theme.js，供 mobile.html 等
 * 非 Vite 入口的静态页面使用。
 *
 * 此文件仅用于让 Vite build:renderer 能够解析 HTML 中的
 * <script type="module" src="lib/theme.js"> 引用。
 */
import '../shared/theme.ts';
