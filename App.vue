<script>
import { initAppStore } from './utils/store.js';
import { triggerAutoSync } from './utils/cloud.js';

export default {
  onLaunch() {
    initAppStore();
    triggerAutoSync('launch');
  },
  onShow() {
    triggerAutoSync('show');
  }
};
</script>

<style>
/* =========================================================
   极速刷题宝 · 全平台通用样式 (微信小程序 / App / H5 / 桌面端)
   注意：避免使用小程序不支持的通配符 * 选择器
   ========================================================= */

page {
  --bg: #f4f6fb;
  --surface: #ffffff;
  --surface-alt: #f8fafc;
  --surface-hover: #f1f5f9;
  --border: #e2e8f0;
  --border-strong: #cbd5e1;
  --text: #0f172a;
  --text-sec: #475569;
  --text-muted: #64748b;

  --primary: #2563eb;
  --primary-soft: #eff6ff;
  --primary-border: #bfdbfe;

  --green: #16a34a;
  --green-soft: #f0fdf4;
  --green-border: #bbf7d0;

  --red: #dc2626;
  --red-soft: #fef2f2;
  --red-border: #fecaca;

  --amber: #d97706;
  --amber-soft: #fffbeb;
  --amber-border: #fde68a;

  --purple: #7c3aed;
  --purple-soft: #f5f3ff;
  --purple-border: #ddd6fe;

  background-color: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", "Microsoft YaHei", sans-serif;
  font-size: 28rpx;
  line-height: 1.6;
}

.theme-dark {
  --bg: #0b1120;
  --surface: #131c2e;
  --surface-alt: #19253d;
  --surface-hover: #22314f;
  --border: #25344f;
  --border-strong: #364b70;
  --text: #f1f5f9;
  --text-sec: #cbd5e1;
  --text-muted: #94a3b8;

  --primary: #3b82f6;
  --primary-soft: rgba(59, 130, 246, 0.18);
  --primary-border: rgba(59, 130, 246, 0.45);

  --green: #22c55e;
  --green-soft: rgba(34, 197, 94, 0.16);
  --green-border: rgba(34, 197, 94, 0.42);

  --red: #f87171;
  --red-soft: rgba(239, 68, 68, 0.18);
  --red-border: rgba(239, 68, 68, 0.44);

  --amber: #fbbf24;
  --amber-soft: rgba(245, 158, 11, 0.18);
  --amber-border: rgba(245, 158, 11, 0.42);

  --purple: #a78bfa;
  --purple-soft: rgba(139, 92, 246, 0.18);
  --purple-border: rgba(139, 92, 246, 0.42);
}

view,
scroll-view,
button,
input,
textarea,
label,
navigator {
  box-sizing: border-box;
}

.page-root {
  min-height: 100vh;
  background-color: var(--bg);
  color: var(--text);
  padding-bottom: 48rpx;
}

.container {
  max-width: 1040px;
  margin: 0 auto;
  padding: 24rpx 28rpx;
}

.card {
  background-color: var(--surface);
  border: 1px solid var(--border);
  border-radius: 24rpx;
  padding: 32rpx;
  margin-bottom: 24rpx;
  box-shadow: 0 2px 10px rgba(15, 23, 42, 0.04);
}

.row-between {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
}

.row-wrap {
  display: flex;
  flex-direction: row;
  align-items: center;
  flex-wrap: wrap;
  gap: 14rpx;
}

.pill {
  display: inline-flex;
  align-items: center;
  padding: 4rpx 18rpx;
  border-radius: 999px;
  font-size: 22rpx;
  font-weight: 600;
}
.pill-blue { background-color: var(--primary-soft); color: var(--primary); }
.pill-green { background-color: var(--green-soft); color: var(--green); }
.pill-red { background-color: var(--red-soft); color: var(--red); }
.pill-amber { background-color: var(--amber-soft); color: var(--amber); }
.pill-purple { background-color: var(--purple-soft); color: var(--purple); }
.pill-gray { background-color: var(--surface-alt); color: var(--text-muted); border: 1px solid var(--border); }

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 18rpx 32rpx;
  border-radius: 16rpx;
  font-size: 28rpx;
  font-weight: 600;
  line-height: 1.4;
  border: 1px solid transparent;
  margin: 0;
}
.btn::after {
  border: none;
}
.btn-primary {
  background-color: var(--primary);
  color: #ffffff;
}
.btn-secondary {
  background-color: var(--surface-alt);
  color: var(--text);
  border-color: var(--border-strong);
}
.btn-success {
  background-color: var(--green);
  color: #ffffff;
}
.btn-danger {
  background-color: var(--red);
  color: #ffffff;
}
.btn-sm {
  padding: 10rpx 22rpx;
  font-size: 24rpx;
  border-radius: 12rpx;
}
.btn-block {
  width: 100%;
  display: flex;
}

.input-box,
.textarea-box {
  width: 100%;
  background-color: var(--surface-alt);
  border: 1px solid var(--border-strong);
  border-radius: 14rpx;
  padding: 18rpx 22rpx;
  color: var(--text);
  font-size: 28rpx;
}

.textarea-box {
  min-height: 220rpx;
  line-height: 1.6;
}

.text-green { color: var(--green); }
.text-red { color: var(--red); }
.text-amber { color: var(--amber); }
.text-purple { color: var(--purple); }
.text-muted { color: var(--text-muted); }
</style>
