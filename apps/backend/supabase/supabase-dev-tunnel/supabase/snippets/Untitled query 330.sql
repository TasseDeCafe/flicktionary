  WITH session_ctx AS (                                                                                                                                    
    SELECT s.user_id, s.text_track_id, s.target_language                                                                                                   
    FROM public.study_sessions s                                                                                                                           
    WHERE s.id = (SELECT study_session_id FROM public.processing_telemetry                                                                                 
                  WHERE pass_name = 'exclusion_prefilter' ORDER BY created_at DESC LIMIT 1)                                                                
  ),                                                                                                                                                       
  agg AS (                            
    SELECT to_tsvector('english'::regconfig, string_agg(text, ' ')) AS source_tsv                                                                          
    FROM public.text_segments                                                                                                                              
    WHERE text_track_id = (SELECT text_track_id FROM session_ctx)
  )                                                                                                                                                        
  SELECT ul.headword                                                    
  FROM public.user_lookups ul                                                                                                                              
  CROSS JOIN agg                                                        
  WHERE ul.user_id = (SELECT user_id FROM session_ctx)
    AND ul.target_language = (SELECT target_language FROM session_ctx)                                                                                     
    AND ul.deleted_at IS NULL
    AND NOT (agg.source_tsv @@ plainto_tsquery('english'::regconfig, ul.headword))                                                                         
  ORDER BY ul.headword;      