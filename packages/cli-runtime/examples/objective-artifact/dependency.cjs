exports.execute = async (subject, context) => {
  context.signal.throwIfAborted();
  const resolved = context.data.resolutions?.[0];
  return {
    status: 200,
    message: "",
    payload: resolved
      ? resolved.result
      : {
          ok: false,
          problems: [],
          requirements: [
            {
              objectiveId: "objective:composition-prerequisite",
              subject: { ready: subject.ready },
              expectedLevelId: "done",
            },
          ],
        },
  };
};
