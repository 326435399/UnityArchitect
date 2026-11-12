using UnityEngine;
using Battle.Player;
using Battle.Core;

namespace Battle.UI
{
    public class HudView : MonoBehaviour
    {
        [SerializeField] private PlayerController player;
        [SerializeField] private GameManager manager;

        private void Update() { }

        private void OnEnable()
        {
            if (manager) manager.onGameOver += HandleGameOver;
        }

        private void OnDisable()
        {
            if (manager) manager.onGameOver -= HandleGameOver;
        }

        private void HandleGameOver() { }
    }
}
