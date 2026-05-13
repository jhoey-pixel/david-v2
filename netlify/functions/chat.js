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
- only ask for the user's name after several exchanges, when the tone is naturally established
- if appropriate, ask naturally with language like: "By the way, what should I call you?"
- once you know the user's name, occasionally use it naturally for grounding and clarity
- do NOT use the user's name every response and do NOT overuse it
- occasionally acknowledge progress, summarize emerging clarity, and notice meaningful patterns
- keep this subtle; avoid sounding motivational, cheesy, overly supportive, or scripted`;

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

    const conversationTurnCount = history.filter((item) => item?.role === 'user').length;
    const memoryContext = {
      userName: typeof memory.userName === 'string' ? memory.userName : null,
      shouldAvoidAskingName: Boolean(memory.userName),
      userTurnsSoFar: conversationTurnCount,
      nameAskEligible: conversationTurnCount >= 3,
    };

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'system',
        content: `Conversation memory:\n${JSON.stringify(memoryContext, null, 2)}`,
      },
      ...history
        .filter((item) => item?.role && item?.content)
        .map((item) => ({ role: item.role, content: String(item.content) })),
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
      body: JSON.stringify({ reply }),
    };
  } catch (error) {
    console.error('[chat function] Unexpected server error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server error', details: error.message }),
    };
  }
};
