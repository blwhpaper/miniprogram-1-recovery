const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const USERS_COLLECTION = 'users'
const TEACHERS_COLLECTION = 'teachers'

let localSettings = {}
try {
  // Local-only admin review password config. Keep this out of committed production paths.
  localSettings = require('./local.settings.json')
} catch (err) {
  localSettings = {}
}

const DEV_ADMIN_REVIEW_PASSWORD = String(localSettings.DEV_ADMIN_REVIEW_PASSWORD || '').trim()
const ADMIN_REVIEW_KEYS = DEV_ADMIN_REVIEW_PASSWORD ? [DEV_ADMIN_REVIEW_PASSWORD] : []
const ADMIN_OPENIDS = []
const TEACHERS_SOURCE_UNAVAILABLE_CODE = 'TEACHERS_SOURCE_UNAVAILABLE'

function normalizeApplication(application = {}, openId = '') {
  if (!application || typeof application !== 'object') {
    return null
  }

  const applicantName = String(application.applicantName || '').trim()
  const contactInfo = String(application.contactInfo || '').trim()
  const remark = String(application.remark || '').trim()
  const status = String(application.status || '').trim()

  if (!applicantName && !contactInfo && !status) {
    return null
  }

  return {
    applicantOpenId: String(application.applicantOpenId || openId || '').trim(),
    applicantName,
    contactInfo,
    remark,
    status,
    createdAt: application.createdAt || null,
    updatedAt: application.updatedAt || null,
    reviewedAt: application.reviewedAt || null,
    reviewedByOpenId: String(application.reviewedByOpenId || '').trim()
  }
}

function normalizeTeacherProfile(profile = {}) {
  if (!profile || typeof profile !== 'object') {
    return null
  }

  const teacherId = String(profile.teacherId || '').trim()
  const status = String(profile.status || '').trim()
  if (!teacherId && !status) {
    return null
  }

  return {
    teacherId,
    status,
    approvedAt: profile.approvedAt || null,
    updatedAt: profile.updatedAt || null
  }
}

function normalizeTeacherRecord(record = {}) {
  if (!record || typeof record !== 'object') {
    return null
  }

  const userOpenid = String(record.userOpenid || record.openid || '').trim()
  const teacherId = String(record.teacherId || '').trim()
  const status = String(record.status || '').trim()

  if (!userOpenid && !teacherId && !status) {
    return null
  }

  return {
    userOpenid,
    openid: String(record.openid || userOpenid).trim(),
    teacherId,
    status,
    isTestTeacher: !!record.isTestTeacher,
    applicationId: String(record.applicationId || '').trim(),
    name: String(record.name || '').trim(),
    contactInfo: String(record.contactInfo || record.phone || '').trim(),
    phone: String(record.phone || record.contactInfo || '').trim(),
    appliedAt: record.appliedAt || null,
    createdAt: record.createdAt || null,
    updatedAt: record.updatedAt || null,
    approvedAt: record.approvedAt || null,
    approvedBy: String(record.approvedBy || '').trim()
  }
}

function teacherRecordToProfile(record = {}) {
  const normalizedRecord = normalizeTeacherRecord(record)
  if (!normalizedRecord) {
    return null
  }

  return normalizeTeacherProfile({
    teacherId: normalizedRecord.teacherId,
    status: normalizedRecord.status,
    approvedAt: normalizedRecord.approvedAt,
    updatedAt: normalizedRecord.updatedAt
  })
}

function getTeacherEntityProfile(teacherRecord = null, teacherProfile = null) {
  const teacherProfileFromRecord = teacherRecordToProfile(teacherRecord)
  if (hasActiveTeacherRecord(teacherRecord)) {
    return teacherProfileFromRecord
  }
  return normalizeTeacherProfile(teacherProfile)
}

function normalizeRoles(roles = {}) {
  if (!roles || typeof roles !== 'object') {
    return {
      teacher: false
    }
  }

  return {
    ...roles,
    teacher: !!roles.teacher
  }
}

function hasTeacherRole(roles = {}) {
  return !!normalizeRoles(roles).teacher
}

function hasActiveTeacherRecord(record = {}) {
  const normalizedRecord = normalizeTeacherRecord(record)
  if (!normalizedRecord) return false
  return normalizedRecord.status === 'active' && !!normalizedRecord.teacherId
}

function isValidContactInfo(contactInfo = '') {
  return /^1[3-9]\d{9}$/.test(String(contactInfo || '').trim())
}

function buildTeacherSourceState({
  teacherRecord = null,
  teacherProfile = null,
  teacherSourceAvailable = true,
  teacherSourceDegraded = false,
  teacherSourceReason = '',
  teacherSourceMessage = ''
} = {}) {
  const normalizedTeacherRecord = normalizeTeacherRecord(teacherRecord)
  const normalizedTeacherProfile = normalizeTeacherProfile(teacherProfile)

  if (!teacherSourceAvailable || teacherSourceDegraded) {
    return {
      teacherSourceStatus: 'degraded',
      teacherSourceLabel: 'teachers 真源异常',
      teacherInfoSource: normalizedTeacherProfile ? 'users-compat' : 'teachers',
      teacherSourceDegraded: true,
      teacherSourceMessage: teacherSourceMessage || 'teachers 真源异常，当前展示为兼容信息'
    }
  }

  if (normalizedTeacherRecord) {
    if (hasActiveTeacherRecord(normalizedTeacherRecord)) {
      return {
        teacherSourceStatus: 'active',
        teacherSourceLabel: '已进入 teachers 真源',
        teacherInfoSource: 'teachers',
        teacherSourceDegraded: false,
        teacherSourceMessage: ''
      }
    }

    if (normalizedTeacherRecord.status === 'pending') {
      return {
        teacherSourceStatus: 'inactive',
        teacherSourceLabel: 'teachers 预建档未生效',
        teacherInfoSource: 'teachers',
        teacherSourceDegraded: false,
        teacherSourceMessage: 'teachers 中存在预建档，仅作老师实体承接，不代表申请流程状态或正式老师身份'
      }
    }

    return {
      teacherSourceStatus: 'inactive',
      teacherSourceLabel: 'teachers 真源未生效',
      teacherInfoSource: 'teachers',
      teacherSourceDegraded: false,
      teacherSourceMessage: 'teachers 中存在记录，但当前不是 active 状态'
    }
  }

  return {
    teacherSourceStatus: 'missing',
    teacherSourceLabel: normalizedTeacherProfile ? '未找到 teachers 真源记录' : '暂无 teachers 真源记录',
    teacherInfoSource: normalizedTeacherProfile ? 'users-compat' : 'teachers',
    teacherSourceDegraded: false,
    teacherSourceMessage: normalizedTeacherProfile
      ? '当前教师信息来自 users 兼容字段，未在 teachers 真源中确认'
      : teacherSourceReason
        ? String(teacherSourceReason).trim()
        : ''
  }
}

function hasAdminAccess({ openId = '', adminReviewKey = '' } = {}) {
  const normalizedOpenId = String(openId || '').trim()
  const normalizedReviewKey = String(adminReviewKey || '').trim()

  if (normalizedOpenId && ADMIN_OPENIDS.includes(normalizedOpenId)) {
    return true
  }

  if (normalizedReviewKey && ADMIN_REVIEW_KEYS.includes(normalizedReviewKey)) {
    return true
  }

  return false
}

function buildTeacherId(user = {}, existingTeacherProfile = {}, existingTeacherRecord = {}) {
  const existingTeacherRecordId = String(existingTeacherRecord?.teacherId || '').trim()
  if (existingTeacherRecordId) return existingTeacherRecordId

  const existingTeacherId = String(existingTeacherProfile?.teacherId || '').trim()
  if (existingTeacherId) return existingTeacherId

  const userIdSeed = String(user?._id || user?._openid || '').replace(/[^0-9a-zA-Z]/g, '').slice(-8).toUpperCase()
  return `TEACHER_${userIdSeed || Date.now()}`
}

function buildApprovedTeacherPatch({
  applicantOpenId = '',
  approvedBy = '',
  targetUser = {},
  targetApplication = {},
  targetTeacherRecord = {},
  nextTeacherProfile = {}
} = {}) {
  const normalizedOpenId = String(applicantOpenId || '').trim()
  const applicationCreatedAt = targetUser?.teacherApplication?.createdAt || targetApplication?.createdAt || null
  const preservedAppliedAt = targetTeacherRecord?.appliedAt || applicationCreatedAt || db.serverDate()
  const preservedCreatedAt = targetTeacherRecord?.createdAt || db.serverDate()
  const approvedAt = targetTeacherRecord?.approvedAt || targetUser?.teacherProfile?.approvedAt || db.serverDate()
  const contactInfo = String(targetApplication?.contactInfo || '').trim()

  return {
    openid: normalizedOpenId,
    userOpenid: normalizedOpenId,
    teacherId: String(nextTeacherProfile?.teacherId || '').trim(),
    name: String(targetApplication?.applicantName || '').trim(),
    contactInfo,
    phone: contactInfo,
    status: 'active',
    isTestTeacher: true,
    applicationId: String(targetUser?._id || '').trim(),
    appliedAt: preservedAppliedAt,
    createdAt: preservedCreatedAt,
    updatedAt: db.serverDate(),
    approvedAt,
    approvedBy: String(approvedBy || '').trim()
  }
}

function getSafeErrorMessage(err = {}) {
  return String(err?.message || err?.errMsg || '').trim()
}

function buildTeacherSourceMeta({
  available = true,
  degraded = false,
  reason = '',
  message = '',
  errorCode = ''
} = {}) {
  return {
    teacherSourceAvailable: !!available,
    teacherSourceDegraded: !!degraded,
    teacherSourceReason: String(reason || '').trim(),
    teacherSourceMessage: String(message || '').trim(),
    teacherSourceErrorCode: String(errorCode || '').trim()
  }
}

function pickTeacherSourceMeta(source = {}) {
  return buildTeacherSourceMeta(source)
}

async function safeGetTeacherRecordByOpenid(userOpenid = '') {
  const normalizedOpenid = String(userOpenid || '').trim()
  if (!normalizedOpenid) {
    return {
      record: null,
      docId: '',
      ...buildTeacherSourceMeta()
    }
  }

  try {
    const teacherRes = await db.collection(TEACHERS_COLLECTION).where({
      userOpenid: normalizedOpenid
    }).limit(1).get()
    const teacherDoc = (teacherRes.data || [])[0] || null
    return {
      record: normalizeTeacherRecord(teacherDoc),
      docId: String(teacherDoc?._id || '').trim(),
      ...buildTeacherSourceMeta()
    }
  } catch (err) {
    return {
      record: null,
      docId: '',
      ...buildTeacherSourceMeta({
        available: false,
        degraded: true,
        reason: 'teachers_unavailable',
        message: getSafeErrorMessage(err),
        errorCode: String(err?.errCode || TEACHERS_SOURCE_UNAVAILABLE_CODE).trim()
      })
    }
  }
}

async function safeListTeacherRecords() {
  try {
    const teacherListRes = await db.collection(TEACHERS_COLLECTION).limit(100).get()
    const teacherByOpenid = new Map(
      (teacherListRes.data || [])
        .map((item) => normalizeTeacherRecord(item))
        .filter(Boolean)
        .map((item) => [item.userOpenid, item])
    )

    return {
      teacherByOpenid,
      ...buildTeacherSourceMeta()
    }
  } catch (err) {
    return {
      teacherByOpenid: new Map(),
      ...buildTeacherSourceMeta({
        available: false,
        degraded: true,
        reason: 'teachers_unavailable',
        message: getSafeErrorMessage(err),
        errorCode: String(err?.errCode || TEACHERS_SOURCE_UNAVAILABLE_CODE).trim()
      })
    }
  }
}

function buildTeachersUnavailableFailure(message = '', meta = {}) {
  return {
    success: false,
    code: TEACHERS_SOURCE_UNAVAILABLE_CODE,
    msg: message || 'teachers 真源不可用，请先初始化或修复 teachers 集合',
    ...buildTeacherSourceMeta(meta)
  }
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext()
  const action = String(event.action || 'get').trim()

  try {
    const userRes = await db.collection(USERS_COLLECTION).where({
      _openid: OPENID
    }).limit(1).get()
    const teacherLookup = await safeGetTeacherRecordByOpenid(OPENID)

    const existingUser = (userRes.data || [])[0] || null
    const existingTeacherRecord = teacherLookup.record
    const existingApplication = normalizeApplication(existingUser?.teacherApplication, OPENID)
    const existingTeacherProfile = normalizeTeacherProfile(existingUser?.teacherProfile)
    const effectiveTeacherProfile = getTeacherEntityProfile(existingTeacherRecord, existingUser?.teacherProfile)
    const existingRoles = normalizeRoles(existingUser?.roles)
    const isTeacherFromTeachers = hasActiveTeacherRecord(existingTeacherRecord)
    const effectiveIsTeacher = isTeacherFromTeachers

    if (action === 'get') {
      return {
        success: true,
        hasApplication: !!existingApplication,
        application: existingApplication,
        teacherProfile: effectiveTeacherProfile,
        teacherRecord: existingTeacherRecord,
        roles: existingRoles,
        isTeacher: effectiveIsTeacher,
        ...pickTeacherSourceMeta(teacherLookup)
      }
    }

    if (action === 'list') {
      const adminReviewKey = String(event.adminReviewKey || '').trim()
      if (!hasAdminAccess({ openId: OPENID, adminReviewKey })) {
        return {
          success: false,
          msg: '无管理员权限'
        }
      }

      const listRes = await db.collection(USERS_COLLECTION).limit(100).get()
      const teacherListLookup = await safeListTeacherRecords()
      const teacherByOpenid = teacherListLookup.teacherByOpenid
      const applications = (listRes.data || [])
        .map((user) => {
          const application = normalizeApplication(user?.teacherApplication, user?._openid || '')
          if (!application) return null
          const teacherRecord = teacherByOpenid.get(String(user?._openid || '').trim()) || null
          const teacherProfile = getTeacherEntityProfile(teacherRecord, user?.teacherProfile)
          const teacherSourceState = buildTeacherSourceState({
            teacherRecord,
            teacherProfile,
            ...teacherListLookup
          })
          return {
            _openid: String(user?._openid || '').trim(),
            application,
            teacherProfile,
            applicationStatus: String(application.status || '').trim(),
            teacherSourceStatus: teacherSourceState.teacherSourceStatus,
            teacherSourceLabel: teacherSourceState.teacherSourceLabel,
            teacherInfoSource: teacherSourceState.teacherInfoSource,
            teacherSourceDegraded: teacherSourceState.teacherSourceDegraded,
            teacherSourceMessage: teacherSourceState.teacherSourceMessage
          }
        })
        .filter(Boolean)
        .sort((a, b) => {
          const aTime = new Date(a.application.updatedAt || a.application.createdAt || 0).getTime() || 0
          const bTime = new Date(b.application.updatedAt || b.application.createdAt || 0).getTime() || 0
          return bTime - aTime
        })

      return {
        success: true,
        applications,
        ...pickTeacherSourceMeta(teacherListLookup)
      }
    }

    if (action === 'review') {
      const adminReviewKey = String(event.adminReviewKey || '').trim()
      if (!hasAdminAccess({ openId: OPENID, adminReviewKey })) {
        return {
          success: false,
          msg: '无管理员权限'
        }
      }

      const applicantOpenId = String(event.applicantOpenId || '').trim()
      const reviewStatus = String(event.reviewStatus || '').trim()

      if (!applicantOpenId) {
        return {
          success: false,
          msg: '缺少申请人 openid'
        }
      }

      if (!['approved', 'rejected'].includes(reviewStatus)) {
        return {
          success: false,
          msg: '无效审核动作'
        }
      }

      const targetRes = await db.collection(USERS_COLLECTION).where({
        _openid: applicantOpenId
      }).limit(1).get()
      const targetUser = (targetRes.data || [])[0] || null
      const targetTeacherLookup = await safeGetTeacherRecordByOpenid(applicantOpenId)
      const targetTeacherRecord = targetTeacherLookup.record
      const targetTeacherDocId = targetTeacherLookup.docId

      if (!targetUser) {
        return {
          success: false,
          msg: '申请记录不存在'
        }
      }

      const targetApplication = normalizeApplication(targetUser.teacherApplication, applicantOpenId)
      if (!targetApplication) {
        return {
          success: false,
          msg: '申请记录不存在'
        }
      }

      if (!targetTeacherLookup.teacherSourceAvailable) {
        return buildTeachersUnavailableFailure('teachers 真源不可用，无法完成审核，请先初始化或修复 teachers 集合', targetTeacherLookup)
      }

      const nextApplication = {
        applicantOpenId,
        applicantName: targetApplication.applicantName,
        contactInfo: targetApplication.contactInfo,
        remark: targetApplication.remark,
        status: reviewStatus,
        createdAt: targetUser.teacherApplication?.createdAt || db.serverDate(),
        updatedAt: db.serverDate(),
        reviewedAt: db.serverDate(),
        reviewedByOpenId: OPENID
      }

      const nextTeacherProfile = reviewStatus === 'approved'
        ? {
            teacherId: buildTeacherId(targetUser, targetUser.teacherProfile, targetTeacherRecord),
            status: 'active',
            approvedAt: targetUser.teacherProfile?.approvedAt || db.serverDate(),
            updatedAt: db.serverDate()
          }
        : _.remove()
      const nextRoles = {
        ...normalizeRoles(targetUser.roles),
        teacher: reviewStatus === 'approved'
      }
      const approvedTeacherPatch = reviewStatus === 'approved'
        ? buildApprovedTeacherPatch({
            applicantOpenId,
            approvedBy: OPENID,
            targetUser,
            targetApplication,
            targetTeacherRecord,
            nextTeacherProfile
          })
        : null

      try {
        await db.runTransaction(async (transaction) => {
          await transaction.collection(USERS_COLLECTION).doc(targetUser._id).update({
            data: {
              teacherApplication: nextApplication,
              teacherProfile: nextTeacherProfile,
              roles: nextRoles
            }
          })

          if (reviewStatus === 'approved') {
            if (targetTeacherDocId) {
              await transaction.collection(TEACHERS_COLLECTION).doc(targetTeacherDocId).update({
                data: {
                  ...approvedTeacherPatch,
                  rejectedReason: _.remove()
                }
              })
            } else {
              await transaction.collection(TEACHERS_COLLECTION).add({
                data: approvedTeacherPatch
              })
            }
          } else if (targetTeacherDocId) {
            await transaction.collection(TEACHERS_COLLECTION).doc(targetTeacherDocId).update({
              data: {
                status: 'inactive',
                updatedAt: db.serverDate(),
                approvedBy: OPENID
              }
            })
          }
        })
      } catch (err) {
        return buildTeachersUnavailableFailure('teachers 真源写入失败，审核未提交，请检查 teachers 集合后重试', {
          available: false,
          degraded: true,
          reason: 'teachers_write_failed',
          message: getSafeErrorMessage(err),
          errorCode: String(err?.errCode || TEACHERS_SOURCE_UNAVAILABLE_CODE).trim()
        })
      }

      const resultTeacherRecord = reviewStatus === 'approved'
        ? normalizeTeacherRecord({
            ...approvedTeacherPatch,
            updatedAt: null
          })
        : targetTeacherDocId
          ? normalizeTeacherRecord({
              ...targetTeacherRecord,
              status: 'inactive',
              updatedAt: null,
              approvedBy: OPENID
            })
          : null
      const resultTeacherProfile = reviewStatus === 'approved'
        ? normalizeTeacherProfile({
            teacherId: nextTeacherProfile.teacherId,
            status: 'active',
            approvedAt: targetTeacherRecord?.approvedAt || targetUser.teacherProfile?.approvedAt || null,
            updatedAt: null
          })
        : null
      const resultTeacherSourceState = buildTeacherSourceState({
        teacherRecord: resultTeacherRecord,
        teacherProfile: resultTeacherProfile,
        teacherSourceAvailable: true,
        teacherSourceDegraded: false
      })

      return {
        success: true,
        application: normalizeApplication(nextApplication, applicantOpenId),
        teacherProfile: resultTeacherProfile,
        teacherRecord: resultTeacherRecord,
        teacherSourceAvailable: true,
        teacherSourceDegraded: false,
        teacherSourceStatus: resultTeacherSourceState.teacherSourceStatus,
        teacherSourceLabel: resultTeacherSourceState.teacherSourceLabel,
        teacherInfoSource: resultTeacherSourceState.teacherInfoSource,
        teacherSourceMessage: resultTeacherSourceState.teacherSourceMessage,
        msg: reviewStatus === 'approved' ? '审核通过' : '已驳回'
      }
    }

    if (action === 'reset') {
      const adminReviewKey = String(event.adminReviewKey || '').trim()
      if (!hasAdminAccess({ openId: OPENID, adminReviewKey })) {
        return {
          success: false,
          msg: '无管理员权限'
        }
      }

      const applicantOpenId = String(event.applicantOpenId || '').trim()
      if (!applicantOpenId) {
        return {
          success: false,
          msg: '缺少目标账号 openid'
        }
      }

      const targetRes = await db.collection(USERS_COLLECTION).where({
        _openid: applicantOpenId
      }).limit(1).get()
      const targetUser = (targetRes.data || [])[0] || null
      const targetTeacherLookup = await safeGetTeacherRecordByOpenid(applicantOpenId)
      const targetTeacherRecord = targetTeacherLookup.record
      const targetTeacherDocId = targetTeacherLookup.docId

      if (!targetUser) {
        return {
          success: false,
          msg: '目标账号不存在'
        }
      }

      const targetApplication = normalizeApplication(targetUser.teacherApplication, applicantOpenId)
      const targetTeacherProfile = normalizeTeacherProfile(targetUser.teacherProfile)

      if (!targetApplication && !targetTeacherProfile && !targetTeacherRecord) {
        return {
          success: false,
          msg: '当前账号没有老师测试态数据'
        }
      }

      if (!targetTeacherLookup.teacherSourceAvailable) {
        return buildTeachersUnavailableFailure('teachers 真源不可用，无法完成重置，请先初始化或修复 teachers 集合', targetTeacherLookup)
      }

      try {
        await db.runTransaction(async (transaction) => {
          await transaction.collection(USERS_COLLECTION).doc(targetUser._id).update({
            data: {
              teacherApplication: _.remove(),
              teacherProfile: _.remove(),
              roles: {
                ...normalizeRoles(targetUser.roles),
                teacher: false
              }
            }
          })

          if (targetTeacherRecord && targetTeacherDocId) {
            await transaction.collection(TEACHERS_COLLECTION).doc(targetTeacherDocId).update({
              data: {
                status: 'inactive',
                updatedAt: db.serverDate()
              }
            })
          }
        })
      } catch (err) {
        return buildTeachersUnavailableFailure('teachers 真源写入失败，重置未完成，请检查 teachers 集合后重试', {
          available: false,
          degraded: true,
          reason: 'teachers_write_failed',
          message: getSafeErrorMessage(err),
          errorCode: String(err?.errCode || TEACHERS_SOURCE_UNAVAILABLE_CODE).trim()
        })
      }

      const resetTeacherSourceState = buildTeacherSourceState({
        teacherRecord: targetTeacherRecord && targetTeacherDocId
          ? normalizeTeacherRecord({
              ...targetTeacherRecord,
              status: 'inactive',
              updatedAt: null
            })
          : null,
        teacherProfile: null,
        teacherSourceAvailable: true,
        teacherSourceDegraded: false
      })

      return {
        success: true,
        teacherSourceAvailable: true,
        teacherSourceDegraded: false,
        teacherSourceStatus: resetTeacherSourceState.teacherSourceStatus,
        teacherSourceLabel: resetTeacherSourceState.teacherSourceLabel,
        teacherInfoSource: resetTeacherSourceState.teacherInfoSource,
        teacherSourceMessage: resetTeacherSourceState.teacherSourceMessage,
        msg: '已重置老师测试态'
      }
    }

    if (action !== 'submit') {
      return {
        success: false,
        msg: 'invalid action'
      }
    }

    const applicantName = String(event.applicantName || '').trim()
    const contactInfo = String(event.contactInfo || '').trim()
    const remark = String(event.remark || '').trim()

    if (!applicantName) {
      return {
        success: false,
        msg: '请输入姓名'
      }
    }

    if (!contactInfo) {
      return {
        success: false,
        msg: '请输入联系方式'
      }
    }

    if (!isValidContactInfo(contactInfo)) {
      return {
        success: false,
        msg: '请输入正确的手机号'
      }
    }

    if (effectiveIsTeacher && effectiveTeacherProfile?.teacherId) {
      return {
        success: true,
        alreadyTeacher: true,
        application: existingApplication,
        teacherProfile: effectiveTeacherProfile,
        teacherRecord: existingTeacherRecord,
        roles: existingRoles,
        msg: '当前账号已具备教师身份',
        ...pickTeacherSourceMeta(teacherLookup)
      }
    }

    if (existingApplication?.status === 'pending') {
      return {
        success: true,
        alreadySubmitted: true,
        application: existingApplication,
        roles: existingRoles,
        msg: '已提交，等待审核',
        ...pickTeacherSourceMeta(teacherLookup)
      }
    }

    const teacherApplication = {
      applicantOpenId: OPENID,
      applicantName,
      contactInfo,
      remark,
      status: 'pending',
      createdAt: existingApplication?.createdAt || db.serverDate(),
      updatedAt: db.serverDate()
    }

    const nextPendingTeacherRecord = normalizeTeacherRecord({
      ...(existingTeacherRecord || {}),
      userOpenid: OPENID,
      openid: OPENID,
      name: applicantName,
      contactInfo,
      phone: contactInfo,
      status: 'pending',
      appliedAt: existingTeacherRecord?.appliedAt || db.serverDate(),
      updatedAt: db.serverDate()
    })

    if (teacherLookup.teacherSourceAvailable) {
      await db.runTransaction(async (transaction) => {
        if (existingUser) {
          await transaction.collection(USERS_COLLECTION).doc(existingUser._id).update({
            data: {
              teacherApplication
            }
          })
        } else {
          await transaction.collection(USERS_COLLECTION).add({
            data: {
              _openid: OPENID,
              teacherApplication
            }
          })
        }

        if (teacherLookup.docId) {
          await transaction.collection(TEACHERS_COLLECTION).doc(teacherLookup.docId).update({
            data: {
              userOpenid: OPENID,
              openid: OPENID,
              name: applicantName,
              contactInfo,
              phone: contactInfo,
              status: 'pending',
              appliedAt: existingTeacherRecord?.appliedAt || db.serverDate(),
              updatedAt: db.serverDate()
            }
          })
        } else {
          await transaction.collection(TEACHERS_COLLECTION).add({
            data: {
              userOpenid: OPENID,
              openid: OPENID,
              name: applicantName,
              contactInfo,
              phone: contactInfo,
              status: 'pending',
              appliedAt: db.serverDate(),
              updatedAt: db.serverDate()
            }
          })
        }
      })
    } else if (existingUser) {
      await db.collection(USERS_COLLECTION).doc(existingUser._id).update({
        data: {
          teacherApplication
        }
      })
    } else {
      await db.collection(USERS_COLLECTION).add({
        data: {
          _openid: OPENID,
          teacherApplication
        }
      })
    }

    return {
      success: true,
      alreadySubmitted: false,
      application: normalizeApplication(teacherApplication, OPENID),
      teacherProfile: effectiveTeacherProfile,
      teacherRecord: teacherLookup.teacherSourceAvailable ? nextPendingTeacherRecord : existingTeacherRecord,
      roles: existingRoles,
      msg: '提交成功',
      ...pickTeacherSourceMeta(teacherLookup)
    }
  } catch (err) {
    return {
      success: false,
      msg: '系统错误: ' + err.message
    }
  }
}
