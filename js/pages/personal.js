/**
 * pages/personal.js — 个人中心
 * ============================
 * 功能：展示用户信息与统计、编辑个人资料、菜单跳转、关于系统弹窗与退出登录。
 * 交互模块：DPA.ui(弹窗/提示/转义)、DPA.store(用户/打卡/方案/收藏数据)、
 *          DPA.auth(当前会话/资料保存)。
 * 说明：修复原实现中"登录写 isAdmin、个人中心读 role"导致的权限判断不一致问题。
 */
// IIFE 隔离作用域；未登录先跳登录页。
(function () {
  'use strict';

  if (!DPA.auth.requireAuth()) return;

  var ui = DPA.ui;
  var store = DPA.store;
  var auth = DPA.auth;

  ui.renderNavbar('');
  ui.renderBottomNav('personal');

  var $ = function (id) { return document.getElementById(id); };

  /* ---------- 渲染用户信息 ---------- */
  /**
   * 渲染用户信息：头像、用户名、角色、三类统计与管理员入口显隐。
   * @returns {void} 无返回值；当前无会话时直接返回
   */
  function render() {
    var s = auth.current();
    if (!s) return;

    $('avatarText').textContent = s.username.charAt(0).toUpperCase();
    $('profileName').textContent = s.username;
    $('profileRole').textContent = s.role === 'admin' ? '系统管理员' : '普通用户';

    $('statCheckin').textContent = store.punch.count();
    $('statPlan').textContent = store.plans.count();
    $('statCollect').textContent = store.collections.count();

    // 管理员入口：统一以 role 判断
    $('adminSection').classList.toggle('hidden', s.role !== 'admin');
  }

  /* ---------- 菜单跳转 ---------- */
  // 所有带 data-href 的菜单项点击后跳转
  document.querySelectorAll('.menu-item[data-href]').forEach(function (item) {
    item.addEventListener('click', function () { location.href = item.dataset.href; });
  });

  /* ---------- 编辑资料 ---------- */
  /**
   * 打开「编辑个人资料」弹窗，保存时校验并应用修改（含改名迁移数据键）。
   * @returns {void} 无返回值
   */
  function openEdit() {
    var s = auth.current();
    var user = store.users.findByUsername(s.username) || {};

    ui.modal({
      title: '编辑个人资料',
      okText: '保存',
      html:
        '<div class="form-group"><label class="form-label">用户名</label>' +
          '<input class="form-input" id="editUsername" value="' + ui.escapeAttr(user.username || '') + '"></div>' +
        '<div class="form-group"><label class="form-label">手机号码</label>' +
          '<input class="form-input" id="editPhone" type="tel" placeholder="选填" value="' + ui.escapeAttr(user.phone || '') + '"></div>' +
        '<div class="form-row">' +
          '<div class="form-group"><label class="form-label">年龄</label>' +
            '<input class="form-input" id="editAge" type="number" min="1" max="120" placeholder="选填" value="' + ui.escapeAttr(user.age || '') + '"></div>' +
          '<div class="form-group"><label class="form-label">性别</label>' +
            '<select class="form-select" id="editGender">' +
              ['', '男', '女'].map(function (g) {
                return '<option value="' + g + '"' + (user.gender === g ? ' selected' : '') + '>' + (g || '请选择') + '</option>';
              }).join('') +
            '</select></div>' +
        '</div>' +
        '<div class="form-group"><label class="form-label">糖尿病类型</label>' +
          '<select class="form-select" id="editDiabetesType">' +
            ['', '1型糖尿病', '2型糖尿病', '妊娠型糖尿病', '特殊型糖尿病', '未确诊/预防阶段'].map(function (t) {
              return '<option value="' + t + '"' + (user.diabetesType === t ? ' selected' : '') + '>' + (t || '请选择') + '</option>';
            }).join('') +
          '</select></div>',
      onOk: function (backdrop) {
        var username = backdrop.querySelector('#editUsername').value.trim();
        var phone = backdrop.querySelector('#editPhone').value.trim();

        if (!username) { ui.toast('请输入用户名', 'error'); return false; }
        if (phone && !/^1[3-9]\d{9}$/.test(phone)) { ui.toast('手机号格式不正确', 'error'); return false; }

        var patch = {
          username: username,
          phone: phone,
          age: backdrop.querySelector('#editAge').value,
          gender: backdrop.querySelector('#editGender').value,
          diabetesType: backdrop.querySelector('#editDiabetesType').value
        };

        var oldName = auth.username();

        // 先应用除用户名外的普通字段（store.users.update 有字段白名单）
        var rest = Object.assign({}, patch);
        delete rest.username;
        var res = store.users.update(oldName, rest);
        if (!res.ok) { ui.toast(res.msg, 'error'); return false; }

        // 改名必须走 rename()：它会同步迁移该用户的方案/打卡/收藏等数据键，
        // 否则改名后用户会发现自己的数据「全部消失」
        var moved = 0;
        if (username !== oldName) {
          var renamed = store.users.rename(oldName, username);
          if (!renamed.ok) { ui.toast(renamed.msg, 'error'); return false; }
          moved = renamed.moved || 0;
        }

        // 同步会话中的用户名（保留 user_id / role）
        var s = auth.current() || {};
        store.session.set({
          user_id: s.user_id,
          username: username,
          role: s.role,
          avatar_url: s.avatar
        }, true);

        ui.toast(moved ? ('资料已保存，已迁移 ' + moved + ' 项数据') : '资料已保存');
        setTimeout(function () { location.reload(); }, 600);
      }
    });
  }

  // 编辑资料 / 头像编辑按钮
  $('editProfileBtn').addEventListener('click', openEdit);
  $('avatarEdit').addEventListener('click', openEdit);

  /* ---------- 关于 ---------- */
  // 关于按钮：弹出「关于本系统」信息弹窗
  $('aboutBtn').addEventListener('click', function () {
    ui.modal({
      title: '关于本系统',
      html:
        '<p class="text-sm" style="line-height:1.9;color:var(--text-secondary)">' +
        '<strong>' + ui.escapeHtml(DPA_CONFIG.app.name) + '</strong> v' + ui.escapeHtml(DPA_CONFIG.app.version) + '<br>' +
        '基于 DeepSeek 大模型与 Dify 平台构建的一站式糖尿病预防与治疗健康管理平台。<br><br>' +
        '<strong>功能模块</strong><br>糖尿病科普 · 医师咨询 · 风险预测 · 生活方案 · 健康打卡 · 健康资讯 · AI 智能助手<br><br>' +
        '<strong>免责声明</strong><br>本系统提供的所有健康建议、风险预测结果均基于公开医学指南与 AI 生成，仅供健康科普与参考，不能替代专业医疗诊断与治疗。如有健康问题，请及时就医。' +
        '</p>',
      footer: false
    });
  });

  /* ---------- 退出登录 ---------- */
  // 退出按钮：二次确认后调用 auth.logout 登出
  $('logoutBtn').addEventListener('click', function () {
    ui.confirm({
      title: '确认退出登录？',
      message: '退出后需要重新登录才能使用',
      okText: '确认退出',
      danger: true
    }).then(function (ok) { if (ok) auth.logout(); });
  });

  // 初始化渲染用户信息
  render();
})();
