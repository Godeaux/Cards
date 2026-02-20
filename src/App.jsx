import './App.css'

const checklist = [
  'Lobby join (guest username)',
  'Realtime table state via Supabase',
  '8-player turn order + clockwise dealer',
  'Blind options (1/1, 1/2)',
  'Turn timer options (45-120s)',
  'Rebuy slider (20-500)',
  'Hand history expandable panel',
  'Mobile + desktop responsive layout',
]

function App() {
  return (
    <div className="app">
      <header>
        <h1>Cards — Texas Hold’em MVP</h1>
        <p>Build in progress. Realtime multiplayer + Supabase architecture is being wired now.</p>
      </header>
      <section>
        <h2>Implementation checklist</h2>
        <ul>
          {checklist.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </div>
  )
}

export default App
