import path from 'node:path';
export function configFromEnv(env = process.env) {
  if(env.AUTH_MODE&&env.AUTH_MODE!=='sms')throw new Error('仅支持短信验证码登录，请将AUTH_MODE设为sms。');
  if(env.DEMO_MODE==='true')throw new Error('演示登录已停用，请将DEMO_MODE设为false。');
  const config = {
    demo:false, authMode:'sms', host: env.HOST || '127.0.0.1', port: Number(env.PORT || 3188),
    factoryName: env.FACTORY_NAME || '工厂生产记工',
    dbPath: path.resolve(env.DB_PATH || './data/production.sqlite'),
    secret: env.APP_SECRET || '',
    adminPhone: env.ADMIN_PHONE || '',
    officialRoster: env.OFFICIAL_ROSTER==='true',
    smsUrl: env.SMS_WEBHOOK_URL || '', smsToken: env.SMS_WEBHOOK_TOKEN || '',
    smsProvider: env.SMS_PROVIDER || (env.SMS_WEBHOOK_URL?'webhook':'tencent'),
    tencentSms: {
      secretId: env.TENCENT_SECRET_ID || '', secretKey: env.TENCENT_SECRET_KEY || '',
      sdkAppId: env.TENCENT_SMS_SDK_APP_ID || '', signName: env.TENCENT_SMS_SIGN_NAME || '',
      templateId: env.TENCENT_SMS_TEMPLATE_ID || '', region: env.TENCENT_SMS_REGION || 'ap-beijing',
      templateParams: env.TENCENT_SMS_TEMPLATE_PARAMS || 'code'
    },
    trustProxy: Number(env.TRUST_PROXY || 0)
  };
  if (!['webhook','tencent'].includes(config.smsProvider)) throw new Error('SMS_PROVIDER需为tencent或webhook。');
  if (!['code','code,minutes'].includes(config.tencentSms.templateParams)) throw new Error('TENCENT_SMS_TEMPLATE_PARAMS需为code或code,minutes，与已审核模板变量对应。');
  if (config.secret.length < 32 || !/^1\d{10}$/.test(config.adminPhone)) throw new Error('正式模式需配置至少32位APP_SECRET及ADMIN_PHONE。');
  if (config.smsProvider==='webhook' && !config.smsUrl.startsWith('https://')) throw new Error('短信网关模式需配置HTTPS服务SMS_WEBHOOK_URL。');
  if (config.smsProvider==='tencent') {
    const names=['TENCENT_SECRET_ID','TENCENT_SECRET_KEY','TENCENT_SMS_SDK_APP_ID','TENCENT_SMS_SIGN_NAME','TENCENT_SMS_TEMPLATE_ID'];
    const missing=names.filter(name=>!String(env[name]||'').trim());
    if(missing.length)throw new Error('腾讯云短信尚未配置：'+missing.join('、')+'。');
    if(!/^\d+$/.test(config.tencentSms.sdkAppId)||!/^\d+$/.test(config.tencentSms.templateId))throw new Error('腾讯云短信SdkAppId和模板ID需为数字。');
  }
  if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535) throw new Error('PORT需为有效端口。');
  if (![0,1,2].includes(config.trustProxy)) throw new Error('TRUST_PROXY需为0、1或2；按实际反向代理层数设置。');
  return config;
}
