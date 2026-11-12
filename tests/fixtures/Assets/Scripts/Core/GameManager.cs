using UnityEngine;
using UnityEngine.Events;
using Battle.Player;

namespace Battle.Core
{
    [DisallowMultipleComponent]
    public class GameManager : MonoBehaviour
    {
        public static GameManager Instance { get; private set; }
        [SerializeField] private PlayerController player;
        [SerializeField] private HealthData defaultHealth;
        public UnityEvent onGameOver = new UnityEvent();

        private void Start()
        {
            // runtime component lookup
            player = GetComponent<PlayerController>();
        }

        public void Restart(int level = 0)
        {
            player.TakeDamage(level);
            onGameOver?.Invoke();
        }
    }
}
