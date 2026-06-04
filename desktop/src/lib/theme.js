/**
 * lib/theme.js — HTML 入口模块
 *
 * 旧版由 vite.config.theme.js 单独打包成 IIFE（dist-renderer/lib/theme.js），
 * HTML 用 <script src="lib/theme.js"> 引入。新版把 shared/theme.ts 作为
 * ESM 重新导入到主模块图，HTML 直接 type="module" 引用，由 Vite 一次性
 * bundle。这消除了 "can't be bundled without type=module" 警告，
 * 也不再需要 vite.config.theme.js 和 useSourceThemeInDev 插件。
 */
import "../shared/theme.ts";
