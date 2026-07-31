/**
 * 用戶管理（US6 / T078）。
 *
 * FR-055：檢視與編輯會員資料，並升降權限。
 *
 * 升降權限是敏感操作：資料庫端由 prevent_role_escalation trigger 保證
 * 只有管理員能改 role，前端這層只是介面。變更一律進稽核日誌。
 */

import { createPageHeader, toast } from '../app.js';
import { listProfiles, updateProfile, setUserRole } from '../data/profiles.js';
import { withAudit, ACTIONS } from '../services/audit.js';
import {
  createDataTable, createEmptyRow, actionButton, confirmAction, statusTag
} from '../components/admin-ui.js';
import { formatDateTime } from '../utils/dates.js';
import { toUserMessage } from '../utils/errors.js';
import * as store from '../state/store.js';

export async function renderAdminUsers(panel, context) {
  const profiles = await listProfiles();

  const frag = document.createDocumentFragment();
  frag.append(createPageHeader('用戶管理', `共 ${profiles.length} 位使用者。`));

  if (!profiles.length) {
    frag.append(createEmptyRow('目前沒有任何使用者。有人註冊後就會出現在這裡。'));
    panel.replaceChildren(frag);
    return;
  }

  const rows = profiles.map((profile) => [
    buildNameCell(profile, panel, context),
    profile.phone || '—',
    statusTag(profile.role === 'admin' ? '管理員' : '會員',
      profile.role === 'admin' ? 'info' : 'neutral'),
    formatDateTime(profile.createdAt),
    buildRoleAction(profile, panel, context)
  ]);

  frag.append(createDataTable(
    ['顯示名稱', '聯絡電話', '角色', '建立時間', '權限'],
    rows
  ));

  const note = document.createElement('p');
  note.className = 'field__hint';
  note.textContent = '電子郵件與密碼由認證服務保管，本頁不顯示也不提供修改。';
  frag.append(note);

  panel.replaceChildren(frag);
}

const reload = (panel, context) => renderAdminUsers(panel, context);

/** 顯示名稱可直接就地編輯 */
function buildNameCell(profile, panel, context) {
  const wrap = document.createElement('div');
  wrap.style.display = 'flex';
  wrap.style.gap = 'var(--sp-2)';
  wrap.style.alignItems = 'center';

  const name = document.createElement('span');
  name.textContent = profile.displayName || '（未設定）';

  const edit = actionButton('改名', async () => {
    const next = window.prompt('新的顯示名稱', profile.displayName ?? '');
    if (next === null) return;
    const trimmed = next.trim();
    if (!trimmed) {
      toast('顯示名稱不可為空。', 'error');
      return;
    }
    try {
      await withAudit(
        {
          action: ACTIONS.USER_UPDATE, targetTable: 'profiles', targetId: profile.id,
          summary: { displayName: { from: profile.displayName, to: trimmed } }
        },
        () => updateProfile(profile.id, { displayName: trimmed })
      );
      toast('已更新。', 'ok');
      reload(panel, context);
    } catch (err) {
      toast(toUserMessage(err), 'error');
    }
  });

  wrap.append(name, edit);
  return wrap;
}

function buildRoleAction(profile, panel, context) {
  const isSelf = store.currentProfile()?.id === profile.id;

  // 不允許把自己降權——那會讓管理員把自己鎖在後台外面，且沒有其他人能救
  if (isSelf) {
    const note = document.createElement('span');
    note.className = 'field__hint';
    note.textContent = '（目前登入者）';
    return note;
  }

  const toAdmin = profile.role !== 'admin';
  return actionButton(
    toAdmin ? '升為管理員' : '降為會員',
    async () => {
      const message = toAdmin
        ? `確定要將「${profile.displayName || profile.id}」升為管理員嗎？該帳號將能存取全部後台模組。`
        : `確定要將「${profile.displayName || profile.id}」降為一般會員嗎？`;
      if (!confirmAction(message)) return;

      const nextRole = toAdmin ? 'admin' : 'member';
      try {
        await withAudit(
          {
            action: ACTIONS.USER_ROLE, targetTable: 'profiles', targetId: profile.id,
            summary: { role: { from: profile.role, to: nextRole } }
          },
          () => setUserRole(profile.id, nextRole)
        );
        toast('權限已變更。', 'ok');
        reload(panel, context);
      } catch (err) {
        toast(toUserMessage(err), 'error');
      }
    },
    toAdmin ? '' : 'danger'
  );
}
