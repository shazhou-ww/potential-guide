exports.execute = async (subject, context) => {
  context.signal.throwIfAborted();
  return {
    status: 200,
    message: "",
    payload: subject.value
      ? { ok: true, problems: [] }
      : { ok: false, problems: [{ kind: "internal", id: "not-ready", parameters: {} }] },
  };
};
