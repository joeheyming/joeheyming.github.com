function initializeCalculator() {
  const display = document.querySelector('#calc-display');
  const buttons = document.querySelectorAll('.calculator-button');

  let currentValue = '0';
  let previousValue = null;
  let operation = null;
  let waitingForOperand = false;

  function updateDisplay() {
    display.textContent = currentValue;
  }

  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      const value = button.getAttribute('data-calc');

      if ('0123456789'.includes(value)) {
        if (waitingForOperand) {
          currentValue = value;
          waitingForOperand = false;
        } else {
          currentValue = currentValue === '0' ? value : currentValue + value;
        }
        updateDisplay();
      } else if (value === '.') {
        if (currentValue.indexOf('.') === -1) {
          currentValue += '.';
          updateDisplay();
        }
      } else if (['+', '-', '*', '/'].includes(value)) {
        if (previousValue !== null && !waitingForOperand) {
          calculate();
        }

        previousValue = parseFloat(currentValue);
        operation = value;
        waitingForOperand = true;
      } else if (value === '=') {
        calculate();
      } else if (value === 'clear') {
        currentValue = '0';
        previousValue = null;
        operation = null;
        waitingForOperand = false;
        updateDisplay();
      } else if (value === 'sign') {
        currentValue = (parseFloat(currentValue) * -1).toString();
        updateDisplay();
      } else if (value === 'percent') {
        currentValue = (parseFloat(currentValue) / 100).toString();
        updateDisplay();
      }
    });
  });

  function calculate() {
    if (previousValue !== null && operation && !waitingForOperand) {
      const current = parseFloat(currentValue);
      const previous = previousValue;

      let result;
      switch (operation) {
        case '+':
          result = previous + current;
          break;
        case '-':
          result = previous - current;
          break;
        case '*':
          result = previous * current;
          break;
        case '/':
          result = current !== 0 ? previous / current : 0;
          break;
        default:
          return;
      }

      currentValue = result.toString();
      previousValue = null;
      operation = null;
      waitingForOperand = true;
      updateDisplay();
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initializeCalculator();
});
