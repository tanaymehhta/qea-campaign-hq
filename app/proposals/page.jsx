import ProposalChat from "../../components/proposal-chat";

export default function Proposals() {
  return (
    <>
      <h1>Proposals</h1>
      <p className="sub">
        Chat with the QEA proposal agent — it can price and draft a proposal from a client name
        and address, nothing else. Powered by Qwen, not this app&rsquo;s data.
      </p>
      <ProposalChat />
    </>
  );
}
