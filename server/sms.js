import tencentcloud from 'tencentcloud-sdk-nodejs-sms';

class SmsSendError extends Error {
  constructor(code,requestId='') {
    super('短信发送未成功');
    this.providerCode=typeof code==='string'&&/^(?:AuthFailure|FailedOperation|InvalidParameter|InvalidParameterValue|LimitExceeded|UnauthorizedOperation|UnsupportedOperation|RequestLimitExceeded|InternalError|ResourceUnavailable|ResourceNotFound|ResourceInsufficient|OperationDenied|ClientError|NetworkError|MissingParameter|RequestError)(?:\.[A-Za-z0-9]+)*$/.test(code)?code:'UnknownError';
    this.requestId=typeof requestId==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)?requestId:'';
  }
}

export function smsFailureInfo(error) {
  const code=error instanceof SmsSendError?error.providerCode:'UnknownError';
  return {
    code,requestId:error instanceof SmsSendError?error.requestId:'',
    message:code==='FailedOperation.InsufficientBalanceInSmsPackage'?'短信额度不足，请联系管理员处理后重试':'短信发送失败，请稍后重试'
  };
}

export function createSmsSender(config) {
  if(config.smsProvider==='tencent'){
    const sms=config.tencentSms;
    const client=new tencentcloud.sms.v20210111.Client({
      credential:{secretId:sms.secretId,secretKey:sms.secretKey},region:sms.region,
      profile:{signMethod:'TC3-HMAC-SHA256',httpProfile:{endpoint:'sms.tencentcloudapi.com',reqTimeout:10}}
    });
    return async(phone,code)=>{
      let response;
      try {
        response=await client.SendSms({
          PhoneNumberSet:['+86'+phone],SmsSdkAppId:sms.sdkAppId,SignName:sms.signName,
          TemplateId:sms.templateId,TemplateParamSet:sms.templateParams==='code,minutes'?[code,'5']:[code]
        });
      } catch(error) { throw new SmsSendError(error?.code,error?.requestId); }
      // 腾讯云HTTP成功仍可能包含逐号码失败，只有Ok才能保存有效验证码。
      const statuses=response.SendStatusSet;
      if(!Array.isArray(statuses)||statuses.length!==1||statuses[0]?.Code!=='Ok')throw new SmsSendError(statuses?.[0]?.Code,response.RequestId);
    };
  }
  return async(phone,code)=>{
    const response=await fetch(config.smsUrl,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${config.smsToken}`},body:JSON.stringify({phone,code,ttlMinutes:5,template:'production_login'}),signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new Error('短信发送未成功');
  };
}
