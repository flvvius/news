export function correctChoiceIndexForQuestion(
  questionIndex: number,
  choiceCount: number,
) {
  if (choiceCount <= 1) return 0;
  return (questionIndex + 1) % choiceCount;
}

export function reorderChoicesForQuestion<T extends { id: string }>(
  choices: T[],
  correctChoiceId: string,
  questionIndex: number,
) {
  const correctChoice = choices.find((choice) => choice.id === correctChoiceId);
  if (!correctChoice) return choices;

  const remainingChoices = choices.filter(
    (choice) => choice.id !== correctChoiceId,
  );
  const targetIndex = Math.min(
    correctChoiceIndexForQuestion(questionIndex, choices.length),
    remainingChoices.length,
  );
  return [
    ...remainingChoices.slice(0, targetIndex),
    correctChoice,
    ...remainingChoices.slice(targetIndex),
  ];
}
