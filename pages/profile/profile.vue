<template>
  <view class="page-root" :class="{ 'theme-dark': store.settings.theme === 'dark' }">
    <view class="container">
      <!-- ==================== 1. ACCOUNT & CLOUD SYNC CARD ==================== -->
      <view class="card">
        <!-- Logged Out View -->
        <view v-if="!store.auth.user">
          <view class="row-between" style="margin-bottom: 20rpx">
            <text class="sec-title">☁️ 登录开启全平台实时同步</text>
            <text class="pill pill-blue">小程序 · App · 网页 · 电脑</text>
          </view>
          <view class="text-muted" style="font-size: 25rpx; margin-bottom: 24rpx">
            登录后，你导入的题库、答题进度、错题本、斩杀状态和助记笔记将在所有设备间自动双向增量合并，断网刷题重连后也不会丢失。
          </view>

          <view class="auth-tabs">
            <view class="auth-tab" :class="{ active: authMode === 'login' }" @click="authMode = 'login'">账号登录</view>
            <view class="auth-tab" :class="{ active: authMode === 'register' }" @click="authMode = 'register'">注册新账号</view>
          </view>

          <view class="f-grp">
            <input class="input-box" v-model="formUsername" placeholder="请输入账号名（字母/数字，如 atom01）" />
          </view>
          <view v-if="authMode === 'register'" class="f-grp">
            <input class="input-box" v-model="formNickname" placeholder="昵称（可选，如 阿童木）" />
          </view>
          <view class="f-grp">
            <input class="input-box" password v-model="formPassword" placeholder="请输入密码（至少 6 位）" />
          </view>

          <button class="btn btn-primary btn-block" :disabled="busy" @click="submitPasswordAuth">
            {{ authMode === 'login' ? '🚀 登录并立即同步' : '✨ 注册并同步当前本地题库' }}
          </button>

          <!-- #ifdef MP-WEIXIN -->
          <button class="btn btn-wx btn-block" style="margin-top: 18rpx" :disabled="busy" @click="handleWxOneClick">
            💬 微信一键快捷登录
          </button>
          <!-- #endif -->
        </view>

        <!-- Logged In View -->
        <view v-else>
          <view class="row-between" style="margin-bottom: 20rpx">
            <view>
              <view class="user-name">👋 {{ store.auth.user.nickname || store.auth.user.username }}</view>
              <view class="text-muted" style="font-size: 24rpx">
                {{ store.auth.user.username ? '通行证账号：' + store.auth.user.username : '微信快捷登录账号' }}
              </view>
            </view>
            <text class="pill" :class="store.syncStatus === 'error' ? 'pill-red' : 'pill-green'">
              {{ syncBadgeLabel }}
            </text>
          </view>

          <view class="sync-meta-box">
            <view style="font-size: 25rpx">上次云端同步：{{ lastSyncText }}</view>
            <view class="text-muted" style="font-size: 23rpx; margin-top: 6rpx">
              本地共 {{ store.banks.length }} 个题库 · 多设备离线答题将按最新时间戳智能合并
            </view>
          </view>

          <button class="btn btn-primary btn-block" :disabled="busy" @click="manualSyncNow">
            🔄 立即双向同步全端进度
          </button>

          <!-- Cross-Platform Identity Binding -->
          <view v-if="!store.auth.user.hasPassword" class="bind-box">
            <view class="bind-title">🔗 绑定跨端通行证账号密码（推荐）</view>
            <view class="text-muted" style="font-size: 23rpx; margin-bottom: 14rpx">
              设置账号密码后，你就可以在电脑客户端（Windows/Mac）、网页端和手机 App 登录同一个账号同步进度！
            </view>
            <input class="input-box" v-model="bindUsername" placeholder="设置通行证账号（3位以上字母数字）" style="margin-bottom: 12rpx" />
            <input class="input-box" password v-model="bindPassword" placeholder="设置登录密码（至少 6 位）" style="margin-bottom: 14rpx" />
            <button class="btn btn-secondary btn-sm" @click="handleBindPassword">确认绑定账号密码</button>
          </view>

          <!-- #ifdef MP-WEIXIN -->
          <view v-if="!store.auth.user.hasWxBound" style="margin-top: 18rpx">
            <button class="btn btn-secondary btn-block" @click="handleBindWx">💬 绑定当前微信号（下次可一键登录）</button>
          </view>
          <!-- #endif -->

          <button class="btn btn-secondary btn-block" style="margin-top: 18rpx" @click="confirmLogout">
            退出当前账号（保留本地题库）
          </button>
        </view>
      </view>

      <!-- ==================== 2. STUDY PREFERENCES ==================== -->
      <view class="card">
        <view class="sec-title" style="margin-bottom: 18rpx">⚙️ 刷题偏好设置</view>

        <view class="pref-row">
          <view>
            <view class="pref-name">深夜护眼暗色模式</view>
            <view class="pref-desc">夜间备考降低屏幕刺眼感</view>
          </view>
          <switch :checked="store.settings.theme === 'dark'" color="#2563EB" @change="onDarkChange" />
        </view>

        <view class="pref-row">
          <view>
            <view class="pref-name">单选/判断答对自动下一题</view>
            <view class="pref-desc">提升连续刷题流畅度</view>
          </view>
          <switch :checked="store.settings.autoNextOnCorrect" color="#2563EB" @change="onAutoNextChange" />
        </view>

        <view class="pref-row">
          <view>
            <view class="pref-name">错题答对自动移出错题本</view>
            <view class="pref-desc">在错题本模式中答对即销号</view>
          </view>
          <switch :checked="store.settings.autoRemoveWrongOnCorrect" color="#2563EB" @change="onAutoRemoveChange" />
        </view>

        <view class="pref-row">
          <view>
            <view class="pref-name">斩杀冲刺达标次数</view>
            <view class="pref-desc">连续答对几次自动标记为“已斩杀”</view>
          </view>
          <picker mode="selector" :range="streakLabels" :value="streakIdx" @change="onStreakChange">
            <view class="op-pill">{{ streakLabels[streakIdx] }} ▾</view>
          </picker>
        </view>

        <view class="pref-row" style="border-bottom: none">
          <view>
            <view class="pref-name">题目字号大小</view>
            <view class="pref-desc">适配手机小屏与电脑大屏阅读</view>
          </view>
          <picker mode="selector" :range="fontLabels" :value="fontIdx" @change="onFontChange">
            <view class="op-pill">{{ fontLabels[fontIdx] }} ▾</view>
          </picker>
        </view>
      </view>

      <!-- ==================== 3. CLOUD ENDPOINT CONFIG ==================== -->
      <view class="card">
        <view class="row-between" @click="showCloudCfg = !showCloudCfg">
          <text class="sec-title">🛠️ 云端服务连接设置（uniCloud）</text>
          <text class="text-muted">{{ showCloudCfg ? '收起 ▴' : '展开 ▾' }}</text>
        </view>

        <view v-if="showCloudCfg" style="margin-top: 18rpx">
          <view class="text-muted" style="font-size: 24rpx; line-height: 1.65; margin-bottom: 16rpx">
            • 在 HBuilderX 中关联 uniCloud 服务空间打包的小程序/App 会自动直连云端，无需填写下方地址。<br />
            • 在 GitHub Pages 网页版或 Tauri 电脑客户端使用时，可将 uniCloud 后台开启「云函数 URL 化」后的 HTTPS 地址填在下方，即可全平台互通！
          </view>
          <input
            class="input-box"
            v-model="httpUrlInput"
            placeholder="例如：https://env-xxx.normal.cloudstatic.cn/quiz-sync"
            style="margin-bottom: 16rpx"
          />
          <button class="btn btn-secondary btn-sm" @click="saveCloudUrl">保存云函数 URL</button>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue';
import { store, persistSettings } from '../../utils/store.js';
import {
  registerWithPassword,
  loginWithPassword,
  loginWithWeixin,
  bindUsernamePassword,
  bindCurrentWeixin,
  logoutAccount,
  syncNow
} from '../../utils/cloud.js';

const authMode = ref('login');
const formUsername = ref('');
const formNickname = ref('');
const formPassword = ref('');
const bindUsername = ref('');
const bindPassword = ref('');
const busy = ref(false);

const showCloudCfg = ref(false);
const httpUrlInput = ref(store.settings.cloudHttpUrl || '');

const streakLabels = ['连对 1 次斩杀', '连对 2 次斩杀', '连对 3 次斩杀'];
const streakIdx = computed(() => Math.min(2, Math.max(0, (store.settings.masteryStreakTarget || 1) - 1)));

const FONT_KEYS = ['sm', 'md', 'lg'];
const fontLabels = ['紧凑字号', '标准字号', '大号护眼'];
const fontIdx = computed(() => Math.max(0, FONT_KEYS.indexOf(store.settings.fontSize || 'md')));

const syncBadgeLabel = computed(() => {
  if (store.syncStatus === 'syncing') return '同步中...';
  if (store.syncStatus === 'error') return '同步待重试';
  return '多端已同步';
});

const lastSyncText = computed(() => {
  if (!store.auth.lastSyncAt) return '尚未同步';
  return new Date(store.auth.lastSyncAt).toLocaleString('zh-CN');
});

async function submitPasswordAuth() {
  if (!formUsername.value.trim() || !formPassword.value) {
    uni.showToast({ title: '请填写账号和密码', icon: 'none' });
    return;
  }
  busy.value = true;
  try {
    if (authMode.value === 'register') {
      await registerWithPassword(formUsername.value.trim(), formPassword.value, formNickname.value.trim());
      uni.showToast({ title: '注册并同步成功！', icon: 'success' });
    } else {
      await loginWithPassword(formUsername.value.trim(), formPassword.value);
      uni.showToast({ title: '登录并同步成功！', icon: 'success' });
    }
    formPassword.value = '';
  } catch (err) {
    uni.showToast({ title: err.message || '操作失败', icon: 'none', duration: 3000 });
  } finally {
    busy.value = false;
  }
}

async function handleWxOneClick() {
  busy.value = true;
  try {
    await loginWithWeixin();
    uni.showToast({ title: '微信登录成功！', icon: 'success' });
  } catch (err) {
    uni.showToast({ title: err.message || '微信登录失败', icon: 'none', duration: 3000 });
  } finally {
    busy.value = false;
  }
}

async function manualSyncNow() {
  busy.value = true;
  await syncNow(false);
  busy.value = false;
}

async function handleBindPassword() {
  if (!bindUsername.value.trim() || !bindPassword.value) {
    uni.showToast({ title: '请输入要绑定的账号和密码', icon: 'none' });
    return;
  }
  try {
    await bindUsernamePassword(bindUsername.value.trim(), bindPassword.value);
    bindPassword.value = '';
    uni.showToast({ title: '跨端账号绑定成功！', icon: 'success' });
  } catch (err) {
    uni.showToast({ title: err.message, icon: 'none', duration: 2800 });
  }
}

async function handleBindWx() {
  try {
    await bindCurrentWeixin();
    uni.showToast({ title: '微信号绑定成功！', icon: 'success' });
  } catch (err) {
    uni.showToast({ title: err.message, icon: 'none', duration: 2800 });
  }
}

function confirmLogout() {
  uni.showModal({
    title: '退出账号',
    content: '退出后本地已有的题库和记录仍会保留在本设备，确认退出吗？',
    success: (res) => {
      if (res.confirm) logoutAccount();
    }
  });
}

function onDarkChange(e) {
  store.settings.theme = e.detail.value ? 'dark' : 'light';
  persistSettings();
}
function onAutoNextChange(e) {
  store.settings.autoNextOnCorrect = Boolean(e.detail.value);
  persistSettings();
}
function onAutoRemoveChange(e) {
  store.settings.autoRemoveWrongOnCorrect = Boolean(e.detail.value);
  persistSettings();
}
function onStreakChange(e) {
  store.settings.masteryStreakTarget = (Number(e.detail.value) || 0) + 1;
  persistSettings();
}
function onFontChange(e) {
  store.settings.fontSize = FONT_KEYS[Number(e.detail.value) || 1];
  persistSettings();
}
function saveCloudUrl() {
  store.settings.cloudHttpUrl = httpUrlInput.value.trim();
  persistSettings();
  uni.showToast({ title: '云函数 URL 已保存', icon: 'success' });
}
</script>

<style scoped>
.sec-title { font-size: 30rpx; font-weight: 700; }

.auth-tabs {
  display: flex; flex-direction: row; background-color: var(--surface-alt);
  border-radius: 14rpx; padding: 6rpx; margin-bottom: 22rpx;
}
.auth-tab {
  flex: 1; text-align: center; padding: 14rpx 0; border-radius: 10rpx;
  font-size: 26rpx; font-weight: 600; color: var(--text-muted);
}
.auth-tab.active {
  background-color: var(--surface); color: var(--primary);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}
.f-grp { margin-bottom: 18rpx; }
.btn-wx { background-color: #07c160; color: #ffffff; }

.user-name { font-size: 34rpx; font-weight: 800; margin-bottom: 4rpx; }
.sync-meta-box {
  background-color: var(--surface-alt); border: 1px solid var(--border);
  border-radius: 16rpx; padding: 20rpx 24rpx; margin-bottom: 22rpx;
}
.bind-box {
  margin-top: 24rpx; padding: 22rpx; border-radius: 16rpx;
  background-color: var(--primary-soft); border: 1px solid var(--primary-border);
}
.bind-title { font-size: 26rpx; font-weight: 700; color: var(--primary); margin-bottom: 6rpx; }

.pref-row {
  display: flex; flex-direction: row; align-items: center; justify-content: space-between;
  padding: 20rpx 0; border-bottom: 1px solid var(--border);
}
.pref-name { font-size: 28rpx; font-weight: 600; }
.pref-desc { font-size: 23rpx; color: var(--text-muted); margin-top: 4rpx; }
.op-pill {
  padding: 10rpx 20rpx; border-radius: 12rpx;
  background-color: var(--surface-alt); border: 1px solid var(--border-strong); font-size: 24rpx;
}
</style>
