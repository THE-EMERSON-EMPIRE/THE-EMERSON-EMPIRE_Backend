-- Correct line breaks in only the three reviewed synthetic assignment prompts.
-- Prior applied migration checksums and all saved answers/receipts stay intact.
UPDATE synthetic_learning.items SET content=replace(content,chr(92)||'n',chr(10))
WHERE kind='assignment' AND (
  (id='30000000-0000-4000-8000-000000000004'
    AND description='Write a fictional reflection, save a draft, then submit it once.'
    AND content='SYNTHETIC ASSIGNMENT\nUsing an invented situation, describe how you would communicate a changed deadline. Include the audience, the message, and one question to confirm understanding.\nUse fictional text only. Submitted answers are final. No uploads, grading, awards or lesson progress are created.')
  OR (id='30000000-0000-4000-8000-000000000007'
    AND description='Write a fictional action plan, save a draft, then submit it once.'
    AND content='SYNTHETIC ASSIGNMENT\nPrepare an imaginary action plan with a goal, a first step, and a review date.\nUse fictional text only. Submitted answers are final. No documents, grading or real personal information.')
  OR (id='30000000-0000-4000-8000-000000000010'
    AND description='Write a fictional School B reflection, save a draft, then submit it once.'
    AND content='SYNTHETIC SCHOOL B ASSIGNMENT\nDescribe an imaginary work routine using fictional text only. Save a draft, then submit it once. Submitted answers are final. No files, grading or awards.')
);
