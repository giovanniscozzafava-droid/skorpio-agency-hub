
CREATE TABLE public.chat_reactions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  msg_id uuid NOT NULL,
  emoji text NOT NULL,
  autore text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  UNIQUE (msg_id, emoji, autore)
);

ALTER TABLE public.chat_reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_all_chat_reactions"
  ON public.chat_reactions
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);
