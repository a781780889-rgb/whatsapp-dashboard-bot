const DatabaseManager = require('../../database/DatabaseManager');

const ADMIN_ROLES = new Set(['super_admin', 'superadmin', 'admin', 'owner']);

function currentUserId(req) {
  return req.user?.id || req.user?.userId || null;
}

function isAdmin(req) {
  return ADMIN_ROLES.has(req.user?.role);
}

/**
 * Authorize access to /accounts/:accountId resources.
 * Admins may inspect accounts explicitly; regular users may only access
 * accounts owned by their authenticated identity. The account id is never
 * trusted from the client without this database check.
 */
async function requireAccountOwnership(req, res, next) {
  const accountId = req.params.accountId || req.params.id;
  const userId = currentUserId(req);

  if (!accountId) {
    return res.status(400).json({ success: false, error: 'معرف الحساب مطلوب.' });
  }
  if (!userId) {
    return res.status(401).json({ success: false, error: 'غير مصرح.' });
  }

  try {
    const account = await DatabaseManager.systemDB.get(
      'SELECT id, user_id, status FROM accounts WHERE id = $1',
      [accountId]
    );
    if (!account) {
      return res.status(404).json({ success: false, error: 'الحساب غير موجود.' });
    }

    if (!isAdmin(req) && account.user_id !== userId) {
      return res.status(403).json({ success: false, error: 'غير مصرح بالوصول لهذا الحساب.' });
    }

    req.account = account;
    req.accountOwnerId = account.user_id;
    return next();
  } catch (error) {
    console.error('[AccountOwnership] authorization failed:', error.message);
    return res.status(500).json({ success: false, error: 'تعذر التحقق من ملكية الحساب.' });
  }
}

function userScope(req) {
  const userId = currentUserId(req);
  return { userId, admin: isAdmin(req) };
}

async function requireRequestedAccountOwnership(req, res, next) {
  if (isAdmin(req)) return next();
  const input = { ...(req.query || {}), ...(req.body || {}) };
  const ids = [];
  for (const value of [input.accountId, input.targetAccountId]) {
    if (value && value !== 'all') ids.push(String(value));
  }
  if (Array.isArray(input.accountIds)) ids.push(...input.accountIds.map(String));
  const uniqueIds = [...new Set(ids)];
  if (!uniqueIds.length) return next();

  const userId = currentUserId(req);
  if (!userId) return res.status(401).json({ success: false, error: 'غير مصرح.' });
  try {
    const rows = await DatabaseManager.systemDB.all(
      'SELECT id FROM accounts WHERE id = ANY($1) AND user_id = $2',
      [uniqueIds, userId]
    );
    if (rows.length !== uniqueIds.length) {
      return res.status(403).json({ success: false, error: 'يتضمن الطلب حسابًا لا تملكه.' });
    }
    return next();
  } catch (error) {
    console.error('[AccountOwnership] requested ids validation failed:', error.message);
    return res.status(500).json({ success: false, error: 'تعذر التحقق من ملكية الحسابات.' });
  }
}

module.exports = { ADMIN_ROLES, currentUserId, isAdmin, userScope, requireAccountOwnership, requireRequestedAccountOwnership };
