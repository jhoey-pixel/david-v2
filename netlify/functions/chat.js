const SYSTEM_PROMPT = `You are David, a calm clarity-focused thinking partner inspired by Frank Keck’s communication philosophy.

Your role is NOT to simply affirm emotions.

Your role is to:
- understand what the user is actually saying
- identify confusion, friction, pressure, or lack of clarity
- help the user think more clearly
- ask thoughtful connected questions
- continue the flow of conversation naturally
- avoid repeating questions
- avoid robotic therapy language
- avoid generic motivational responses
- stay calm, grounded, concise, and human

David should respond like a wise thinking partner helping the user gain clarity before action.

David should:
- track the conversation context
- use conversation memory (such as the user's preferred name) when provided
- respond to the actual meaning of the user’s message
- ask one useful follow-up question when needed
- evolve the conversation naturally
- sound human and intelligent

Relational personalization rules:
- do NOT ask for the user's name at the beginning of the conversation
- only ask for the user's name after several exchanges (roughly 5-10 user messages), when the tone is naturally established
- if appropriate, ask naturally with language like: "By the way, what should I call you?"
- ask for the name only occasionally, not repeatedly
- once you know the user's name, occasionally use it naturally for grounding and clarity
- do NOT use the user's name every response and do NOT overuse it
- during longer conversations, occasionally summarize or reflect emerging clarity
- occasionally acknowledge progress or insight in a grounded way
- keep recap/reflection moments occasional, not constant
- keep tone calm, human, grounded, relational, and clarity-oriented
- avoid sounding scripted, therapy-like, overly motivational, or repetitive`;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    console.error('[chat function] Invalid method:', event.httpMethod);
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  if (!process.env.OPENAI_API_KEY) {
    console.error('[chat function] Missing OPENAI_API_KEY environment variable.');
    return { statusCode: 500, body: JSON.stringify({ error: 'OPENAI_API_KEY is not configured' }) };
  }

  try {
    const { message, history = [], memory = {} } = JSON.parse(event.body || '{}');

    if (!message || typeof message !== 'string') {
      console.error('[chat function] Invalid request body. message is required.');
      return { statusCode: 400, body: JSON.stringify({ error: 'A message is required' }) };
    }

    const sanitizedHistory = history
      .filter((item) => item?.role && item?.content)
      .map((item) => ({ role: item.role, content: String(item.content) }));

    const userMessageCount = sanitizedHistory.filter((item) => item.role === 'user').length;
    const assistantMessageCount = sanitizedHistory.filter((item) => item.role === 'assistant').length;
    const exchangeCount = Math.min(userMessageCount, assistantMessageCount);

    function extractNameFromMessage(input) {
      const patterns = [
        /(?:my name is|i am|i'm|im|call me)\s+([A-Za-z][A-Za-z'\-]{1,30})\b/i,
        /^([A-Za-z][A-Za-z'\-]{1,30})$/,
      ];
      const trimmedInput = input.trim();
      for (const pattern of patterns) {
        const match = trimmedInput.match(pattern);
        if (match?.[1]) return match[1];
      }
      return null;
    }

    const extractedName = extractNameFromMessage(message);
    const resolvedUserName =
      (typeof memory.userName === 'string' && memory.userName.trim()) || extractedName || null;
    const hasUserName = typeof resolvedUserName === 'string' && resolvedUserName.length > 0;

    const shouldNudgeForName = !hasUserName && exchangeCount >= 5 && exchangeCount <= 7;
    const shouldRecapNow = exchangeCount >= 8 && exchangeCount % 3 === 2;

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...(
        hasUserName
          ? [{
              role: 'system',
              content: `The user’s name is ${resolvedUserName}. Use it occasionally, not every time.`,
            }]
          : []
      ),
      ...(
        shouldNudgeForName
          ? [{
              role: 'system',
              content: `The user’s name is not known yet. Naturally ask: ‘By the way, what should I call you?’ Do this briefly and conversationally.`,
            }]
          : []
      ),
      ...(
        shouldRecapNow
          ? [{
              role: 'system',
              content:
                'Before your next clarity question, briefly recap what you are hearing so far in a human, grounded way (for example: “Let me pause and reflect back what I’m hearing so far…”). Keep the recap short and clarity-focused.',
            }]
          : []
      ),
      {
        role: 'system',
        content: `Conversation state: ${JSON.stringify({ exchangeCount, userMessageCount, assistantMessageCount, hasUserName })}`,
      },
      ...sanitizedHistory,
      { role: 'user', content: message },
    ];

    const openAIResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        messages,
        temperature: 0.7,
      }),
    });

    if (!openAIResponse.ok) {
      const errorPayload = await openAIResponse.text();
      console.error('[chat function] OpenAI request failed:', openAIResponse.status, errorPayload);
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'OpenAI request failed', details: errorPayload }),
      };
    }

    const completion = await openAIResponse.json();
    const reply = completion?.choices?.[0]?.message?.content?.trim();

    if (!reply) {
      console.error('[chat function] Empty reply from OpenAI:', JSON.stringify(completion));
      return { statusCode: 502, body: JSON.stringify({ error: 'OpenAI returned an empty response' }) };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reply,
        memory: {
          ...memory,
          userName: resolvedUserName,
          exchangeCount,
        },
      }),
    };
  } catch (error) {
    console.error('[chat function] Unexpected server error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server error', details: error.message }),
    };
  }
};
