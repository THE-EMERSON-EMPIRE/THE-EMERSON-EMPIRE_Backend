'use strict';
// Fixed fictional references for the isolated CRM-to-learning experiment only.
const id=(prefix,n=1)=>`${String(prefix).padEnd(8,'0')}-0000-4000-8000-${String(n).padStart(12,'0')}`;
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
module.exports=freeze({
  reviewerId:id('80'),personId:id('81'),applicationId:id('82'),crmProgramId:id('83'),mappingId:id('84'),
  programId:id('85'),enrollmentId:id('86'),lessonId:id('87'),assignmentId:id('87',2),resourceId:id('88'),mentorAssignmentId:id('89'),
  learnerEmail:'learner-b@epdg.invalid',mentorEmail:'school-b@epdg.invalid',mentorLabel:'SYNTHETIC Mentor B',
  title:'SYNTHETIC CRM Onboarding Practice',
  summary:'A fictional learning program available only after a current synthetic CRM onboarding clearance.',
  startsAt:'2026-10-24T00:00:00.000Z',endsAt:'2026-11-07T00:00:00.000Z',policyVersion:'synthetic-onboarding-v1',
  items:[
    {id:id('87'),position:1,kind:'lesson',title:'SYNTHETIC From onboarding to learning',day:2,
      description:'Review the fictional transition from CRM clearance to individual learning access.',
      content:'SYNTHETIC PRACTICE\nCRM handles applications and onboarding clearance. The education portal handles learning after that clearance. Review this invented example, then mark the practice lesson complete. Do not enter real applicant or employee information. Completion is self-reported practice, not a grade or qualification.'},
    {id:id('87',2),position:2,kind:'assignment',title:'SYNTHETIC Onboarding handoff reflection',day:4,
      description:'Write and submit an invented first-learning-step reflection after synthetic clearance.',
      content:'SYNTHETIC ASSIGNMENT\nDescribe one imaginary learning goal and a clear next step after fictional onboarding. Save your answer, review it and submit it explicitly. Use fictional text and optional fictional practice files only. No real resumes, personal records or passwords belong here. This exercise awards no grade, credit or qualification.'},
  ],
  resource:{id:id('88'),title:'SYNTHETIC CRM-to-learning guide',
    description:'A fictional reference for the boundary between onboarding and education.',
    body:'SYNTHETIC RESOURCE\n1. CRM retains applications and onboarding evidence.\n2. A current synthetic clearance enables only this assigned practice program.\n3. A hold or withdrawal closes that program while preserving earlier learning evidence.\n4. Owner/admin controls remain closed. Use invented situations only.'},
});
