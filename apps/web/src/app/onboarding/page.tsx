"use client";

import { useState } from "react";

interface TemplateInput {
  key: string;
  label: string;
  type: string;
  options?: string[];
}

interface Template {
  key: string;
  displayName: string;
  bodyJson: {
    required_owner_inputs: TemplateInput[];
  };
}

export default function OnboardingPage() {
  const [step, setStep] = useState<"select_template" | "intake_form" | "generating" | "review" | "sandbox" | "published">("select_template");
  const [templates] = useState<Template[]>([
    {
      key: "coaching_academic",
      displayName: "Coaching & Academic",
      bodyJson: {
        required_owner_inputs: [
          { key: "fees", label: "What are your fees? (or 'on request')", type: "text" },
          { key: "subjects", label: "What subjects/areas do you coach?", type: "text" },
          { key: "session_format", label: "Are sessions online, in-person, or both?", type: "select", options: ["Online", "In-person", "Both"] },
          { key: "availability", label: "What days/times are you available?", type: "text" }
        ]
      }
    },
    {
      key: "ecommerce_retail",
      displayName: "E-commerce & Retail",
      bodyJson: {
        required_owner_inputs: [
          { key: "return_policy", label: "What is your return/exchange policy in short?", type: "text" },
          { key: "delivery_time", label: "Typical delivery time (e.g. 3-5 days)?", type: "text" },
          { key: "cod_available", label: "Do you offer Cash on Delivery (COD)?", type: "text" }
        ]
      }
    }
  ]);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [draftConfig, setDraftConfig] = useState<Record<string, unknown> | null>(null);
  const [chatMessages, setChatMessages] = useState<{role: string, content: string}[]>([]);

  const handleTemplateSelect = (template: Template) => {
    setSelectedTemplate(template);
    setStep("intake_form");
  };

  const handleIntakeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const template = selectedTemplate;
    if (!template) return;
    setStep("generating");

    // Simulate generation for UI prototype
    setTimeout(() => {
      setDraftConfig({
        id: "draft-123",
        personaJson: { role_summary: "Assistant for " + template.displayName, tone: "Professional", languages: ["English"] },
        faqs: [{ q: "What is your schedule?", a: answers.availability || "Flexible" }],
        rulesJson: { lead_capture_fields: [], escalation_rules: [] }
      });
      setStep("review");
    }, 2000);
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 p-8">
      <div className="max-w-3xl mx-auto bg-white rounded-xl shadow-sm p-8 border border-gray-100">
        <h1 className="text-3xl font-bold mb-6 text-indigo-900">AI Agent Onboarding</h1>
        
        {/* Progress Bar */}
        <div className="flex gap-2 mb-8">
          {["select_template", "intake_form", "review", "sandbox"].map((s) => (
            <div key={s} className={`h-2 flex-1 rounded-full ${step === s ? 'bg-indigo-600' : 'bg-gray-200'}`} />
          ))}
        </div>

        {step === "select_template" && (
          <div className="animate-fade-in">
            <h2 className="text-xl font-semibold mb-4">1. Select your Business Niche</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {templates.map(t => (
                <button 
                  key={t.key}
                  onClick={() => handleTemplateSelect(t)}
                  className="p-6 border-2 border-transparent hover:border-indigo-600 bg-gray-50 rounded-lg text-left transition-all"
                >
                  <h3 className="font-bold text-lg text-indigo-900">{t.displayName}</h3>
                  <p className="text-sm text-gray-500 mt-2">Curated defaults for {t.displayName.toLowerCase()} businesses.</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === "intake_form" && selectedTemplate && (
          <div className="animate-fade-in">
            <h2 className="text-xl font-semibold mb-2">2. Business Details</h2>
            <p className="text-gray-500 mb-6">We&apos;ve pre-filled industry defaults. Just tell us the specifics.</p>
            
            <form onSubmit={handleIntakeSubmit} className="space-y-4">
              <div className="space-y-2">
                <label className="block font-medium">Business Name</label>
                <input required type="text" className="w-full p-2 border rounded-md" onChange={(e) => setAnswers({...answers, name: e.target.value})} />
              </div>

              {selectedTemplate.bodyJson.required_owner_inputs.map((input) => (
                <div key={input.key} className="space-y-2">
                  <label className="block font-medium">{input.label}</label>
                  {input.type === 'select' ? (
                    <select className="w-full p-2 border rounded-md" onChange={(e) => setAnswers({...answers, [input.key]: e.target.value})}>
                      <option value="">Select...</option>
                      {input.options?.map((opt: string) => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                  ) : (
                    <input required type="text" className="w-full p-2 border rounded-md" onChange={(e) => setAnswers({...answers, [input.key]: e.target.value})} />
                  )}
                </div>
              ))}
              
              <div className="pt-4 flex justify-between">
                <button type="button" onClick={() => setStep("select_template")} className="text-gray-500 hover:text-gray-700">Back</button>
                <button type="submit" className="bg-indigo-600 text-white px-6 py-2 rounded-md hover:bg-indigo-700 transition-colors">Generate AI Agent</button>
              </div>
            </form>
          </div>
        )}

        {step === "generating" && (
          <div className="text-center py-20 animate-pulse">
            <div className="text-4xl mb-4">✨</div>
            <h2 className="text-2xl font-bold text-indigo-900">Crafting your Agent...</h2>
            <p className="text-gray-500 mt-2">Our AI is reviewing your answers and building a custom configuration.</p>
          </div>
        )}

        {step === "review" && draftConfig && (
          <div className="animate-fade-in">
            <h2 className="text-xl font-semibold mb-2">3. Review & Edit</h2>
            <p className="text-gray-500 mb-6">Here is the draft configuration. You can tweak it before publishing.</p>
            
            <div className="bg-gray-50 p-4 rounded-md mb-6 border border-gray-200">
              <h3 className="font-bold text-gray-700 mb-2">Persona & Tone</h3>
              <textarea 
                className="w-full p-2 border rounded text-sm mb-4" 
                value={(draftConfig.personaJson as { role_summary: string }).role_summary} 
                onChange={(e) => setDraftConfig({...draftConfig, personaJson: {...(draftConfig.personaJson as object), role_summary: e.target.value}})}
                rows={3} 
              />
              
              <h3 className="font-bold text-gray-700 mb-2">FAQs</h3>
              {(draftConfig.faqs as Array<{q: string, a: string}>).map((faq, i: number) => (
                <div key={i} className="mb-4">
                  <input className="w-full p-2 border rounded text-sm mb-1 font-medium" value={faq.q} onChange={(e) => {
                    const newFaqs = [...(draftConfig.faqs as Array<{q: string, a: string}>)];
                    newFaqs[i].q = e.target.value;
                    setDraftConfig({...draftConfig, faqs: newFaqs});
                  }} />
                  <textarea className="w-full p-2 border rounded text-sm" value={faq.a} onChange={(e) => {
                    const newFaqs = [...(draftConfig.faqs as Array<{q: string, a: string}>)];
                    newFaqs[i].a = e.target.value;
                    setDraftConfig({...draftConfig, faqs: newFaqs});
                  }} />
                </div>
              ))}
            </div>

            <div className="flex justify-between">
              <button onClick={() => setStep("sandbox")} className="bg-gray-800 text-white px-6 py-2 rounded-md hover:bg-gray-900 transition-colors">Test in Sandbox</button>
              <button onClick={() => setStep("published")} className="bg-green-600 text-white px-6 py-2 rounded-md hover:bg-green-700 transition-colors">Publish Live</button>
            </div>
          </div>
        )}

        {step === "sandbox" && (
          <div className="animate-fade-in">
            <h2 className="text-xl font-semibold mb-2">4. Sandbox Test Chat</h2>
            <p className="text-gray-500 mb-6">Chat with your drafted agent. Real customers will not see this.</p>
            
            <div className="bg-gray-100 h-96 rounded-lg p-4 flex flex-col mb-6 border border-gray-200">
              <div className="flex-1 overflow-y-auto space-y-4 mb-4">
                {chatMessages.length === 0 && <p className="text-center text-gray-400 mt-10">Send a message to start testing...</p>}
                {chatMessages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`p-3 rounded-lg max-w-[80%] ${msg.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-800 border'}`}>
                      {msg.content}
                    </div>
                  </div>
                ))}
              </div>
              <form onSubmit={(e) => {
                e.preventDefault();
                const form = e.target as HTMLFormElement;
                const input = form.elements[0] as HTMLInputElement;
                if (!input.value.trim()) return;
                setChatMessages([...chatMessages, { role: 'user', content: input.value }]);
                input.value = '';
                // Mock agent response
                setTimeout(() => {
                  setChatMessages(prev => [...prev, { role: 'agent', content: 'This is a mock response based on your config.' }]);
                }, 1000);
              }} className="flex gap-2">
                <input type="text" className="flex-1 p-3 border rounded-full focus:outline-none focus:ring-2 focus:ring-indigo-600" placeholder="Type a message..." />
                <button type="submit" className="bg-indigo-600 text-white px-6 py-3 rounded-full font-bold">Send</button>
              </form>
            </div>

            <div className="flex justify-between">
              <button onClick={() => setStep("review")} className="text-gray-500 hover:text-gray-700">Back to Edit</button>
              <button onClick={() => setStep("published")} className="bg-green-600 text-white px-6 py-2 rounded-md hover:bg-green-700 transition-colors">Looks Good — Publish</button>
            </div>
          </div>
        )}

        {step === "published" && (
          <div className="text-center py-20 animate-fade-in">
            <div className="text-5xl mb-4">🚀</div>
            <h2 className="text-3xl font-bold text-green-600 mb-2">Agent Published!</h2>
            <p className="text-gray-500">Your custom AI agent is now live and handling conversations.</p>
          </div>
        )}
      </div>
    </div>
  );
}
