exports.execute = async subject => ({
  status: 200,
  payload: { ok: subject.ready, problems: subject.ready ? [] : [{ kind: "internal", id: "not-ready", parameters: {} }] },
  message: "",
});
