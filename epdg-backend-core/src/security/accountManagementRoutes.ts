import { Router, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { AccountManagementService } from './AccountManagementService';
import { accountManagementEnabled, accountReleaseConfig } from './accountReleaseConfig';
import { constantEquals, csrfToken, PortalError, sessionCookie } from './primitives';
import { portalOriginAllowed } from './config';

export function createAccountManagementRouter(service = new AccountManagementService()): Router {
  const router=Router();
  const limit=(count:number)=>rateLimit({windowMs:15*60*1000,limit:count,standardHeaders:true,legacyHeaders:false,message:{success:false,message:'Too many requests; try again later'}});
  const body=(req:Request,fields:string[])=>{
    const value:unknown=req.body;
    if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!fields.includes(key)))throw new PortalError(400,'Invalid request fields');
    return value as Record<string,unknown>;
  };
  const wrap=(handler:(req:Request,res:Response,raw:string)=>Promise<void>,publicRoute=false)=>(req:Request,res:Response,next:NextFunction)=>{
    if(!accountManagementEnabled()){next();return;}
    void(async()=>{
      accountReleaseConfig();
      if(req.headers.authorization)throw new PortalError(401,'Authentication required');
      const mutating=!['GET','HEAD'].includes(req.method);
      if(mutating){
        if(!portalOriginAllowed(req.get('Origin'))||req.get('Sec-Fetch-Site')==='cross-site'||req.get('X-EPDG-Request')!=='portal')throw new PortalError(403,'Request verification failed');
        if(!req.is('application/json'))throw new PortalError(415,'JSON content type required');
      }
      const raw=sessionCookie(req);
      if(!publicRoute&&!raw)throw new PortalError(401,'Authentication required');
      if(!publicRoute&&mutating&&!constantEquals(req.get('X-CSRF-Token'),csrfToken(raw as string)))throw new PortalError(403,'Request verification failed');
      if(req.path!=='/admin/account-management'&&Object.keys(req.query).length)throw new PortalError(400,'Query parameters are not accepted');
      await handler(req,res,raw??'');
    })().catch(next);
  };
  router.get('/admin/account-management',wrap(async(req,res,raw)=>{
    if(Object.keys(req.query).some(key=>!['q','status'].includes(key))||Object.values(req.query).some(value=>typeof value!=='string'||value.length>150))throw new PortalError(400,'Invalid search filter');
    res.json({success:true,data:await service.list(raw,req.query as {q?:string;status?:string})});
  }));
  router.post('/admin/account-plans',limit(30),wrap(async(req,res,raw)=>{res.json({success:true,data:await service.propose(raw,body(req,['organization_id','email','name','roles']))});}));
  for(const action of ['verify-onboarding','approve'] as const)router.post(`/admin/account-plans/:id/${action}`,limit(30),wrap(async(req,res,raw)=>{
    res.json({success:true,data:await service.review(raw,req.params.id,action==='approve'?'approve':'verify_onboarding',body(req,action==='approve'?['expected_revision']:['expected_revision','evidence_ref']))});
  }));
  router.post('/admin/account-plans/:id/provision',limit(30),wrap(async(req,res,raw)=>{const input=body(req,['expected_revision']);res.json({success:true,data:await service.provision(raw,req.params.id,input.expected_revision)});}));
  router.post('/admin/accounts/:id/invitations',limit(30),wrap(async(req,res,raw)=>{body(req,[]);res.json({success:true,data:await service.prepare(raw,req.params.id)});}));
  for(const action of ['send','resend'] as const)router.post(`/admin/invitations/:id/${action}`,limit(15),wrap(async(req,res,raw)=>{body(req,[]);res.json({success:true,data:await service.send(raw,req.params.id,action==='resend')});}));
  router.post('/admin/accounts/:id/disable',limit(15),wrap(async(req,res,raw)=>{const input=body(req,['reason_code']);res.json({success:true,data:await service.disable(raw,req.params.id,input.reason_code)});}));
  router.post('/auth/accept-invitation',limit(8),wrap(async(req,res)=>{const input=body(req,['token','password']);res.json({success:true,...await service.accept(input.token,input.password),message:'Invitation accepted; sign in with your email and password'});},true));
  router.get('/portal/workspace',wrap(async(_req,res,raw)=>{res.json({success:true,data:await service.workspace(raw)});}));
  router.patch('/account/self',limit(20),wrap(async(req,res,raw)=>{const input=body(req,['name']);res.json({success:true,data:await service.profile(raw,input.name)});}));
  router.get('/portal/resources/:id',wrap(async(req,res,raw)=>{res.json({success:true,data:await service.resource(raw,req.params.id,'read')});}));
  router.patch('/portal/resources/:id',limit(60),wrap(async(req,res,raw)=>{res.json({success:true,data:await service.resource(raw,req.params.id,'draft',body(req,['draft','expected_revision']))});}));
  router.post('/portal/resources/:id/review',limit(60),wrap(async(req,res,raw)=>{res.json({success:true,data:await service.resource(raw,req.params.id,'review',body(req,['comment']))});}));
  router.post('/portal/resources/:id/publish',limit(30),wrap(async(req,res,raw)=>{res.json({success:true,data:await service.resource(raw,req.params.id,'publish',body(req,['expected_revision']))});}));
  return router;
}
