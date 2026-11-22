// Dragging is an optional shortcut. The stage selector in the table remains the keyboard path.
(() => {
  function setup(board = document.getElementById('pipeline-board')) {
    const form = document.querySelector('form[name="DragStageForm"], form#DragStageForm');
    if (!board || !form || board.dataset.dragReady) return;
    board.dataset.dragReady = 'true';

    for (const card of board.querySelectorAll('.zcrm-deal-card[id^="crm-deal-"]')) card.draggable = true;
    let draggedCard;
    let highlighted;
    function highlight(column) {
      if (highlighted === column) return;
      highlighted?.classList.remove('zcrm-drop-hover');
      column?.classList.add('zcrm-drop-hover');
      highlighted = column;
    }
    function dropTarget(event) {
      const column = event.target.closest('.zcrm-drop-target');
      return draggedCard && column && !column.contains(draggedCard) ? column : null;
    }

    board.addEventListener('dragstart', event => {
      const card = event.target.closest('.zcrm-deal-card[id^="crm-deal-"]');
      if (!card || !event.dataTransfer) return;
      draggedCard = card;
      event.dataTransfer.setData('text/plain', card.id);
      event.dataTransfer.effectAllowed = 'move';
    });
    board.addEventListener('dragover', event => {
      const column = dropTarget(event);
      highlight(column);
      if (!column) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    });
    board.addEventListener('dragleave', event => {
      if (!board.contains(event.relatedTarget)) highlight(null);
    });
    board.addEventListener('dragend', () => {
      draggedCard = null;
      highlight(null);
    });
    board.addEventListener('drop', event => {
      const column = dropTarget(event);
      highlight(null);
      if (!column) return;
      event.preventDefault();
      // Iterated DOM ids include row suffixes. Use the original entity keys for the move.
      const dealInput = form.elements.namedItem('salesOpportunityId');
      const stageInput = form.elements.namedItem('opportunityStageId');
      if (!dealInput || !stageInput) return;
      dealInput.value = draggedCard.querySelector('.zcrm-drag-key').textContent;
      stageInput.value = column.querySelector('.zcrm-drag-key').textContent;
      draggedCard = null;
      dealInput.dispatchEvent(new Event('input', { bubbles: true }));
      stageInput.dispatchEvent(new Event('input', { bubbles: true }));
      form.requestSubmit();
    });
  }

  document.addEventListener('DOMContentLoaded', () => setup());
  document.addEventListener('moqui-screen-loaded', () => setup());
  // The Quasar shell can mount the board after the initial page load.
  document.addEventListener('pointerdown', event => {
    const board = event.target.closest?.('#pipeline-board');
    if (board && !board.dataset.dragReady) setup(board);
  });
  if (document.readyState !== 'loading') setup();
})();
