import { createApp } from 'vue';
import App from './App.vue';
import './style.css';
import '@vue-flow/core/dist/style.css';
import '@vue-flow/controls/dist/style.css';

const app = createApp(App);

app.config.errorHandler = (err) => {
    console.error("Global Vue Error:", err);
    document.body.innerHTML = `<div style="color: red; padding: 20px; font-size: 20px;">
        Global Error: ${String(err)}<br>
        Check console for details.
    </div>`;
};

app.mount('#app');
