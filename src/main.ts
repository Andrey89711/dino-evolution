import './style.css';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Application root #app is missing.');

app.innerHTML = `
  <main>
    <p class="eyebrow">Эволюционный эксперимент</p>
    <h1>Dino Evolution</h1>
    <p>Учимся проходить Chrome Dino с помощью естественного отбора.</p>
    <section aria-labelledby="status-title">
      <h2 id="status-title">Основа проекта готова</h2>
      <p>Следующий этап — игровая симуляция: бег, прыжки, препятствия и столкновения.</p>
      <p>Игра и обучение пока не реализованы. План разработки находится в README.md.</p>
    </section>
  </main>
`;
