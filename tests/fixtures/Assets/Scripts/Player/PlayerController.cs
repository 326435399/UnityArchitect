using UnityEngine;
using UnityEngine.Events;
using System.Collections;
using System.Collections.Generic;
using Battle.Core;
using Battle.Data;

namespace Battle.Player
{
    public interface IDamageable
    {
        void ApplyDamage(int amount);
    }

    [RequireComponent(typeof(Rigidbody))]
    public class PlayerController : MonoBehaviour, IDamageable
    {
        [SerializeField] private int hp = 100;
        [SerializeField] private HealthData config;
        public UnityEvent<int> onDeath;
        public List<GameManager> observers = new List<GameManager>();
        public HealthData[] configList = new HealthData[0];
        public Dictionary<string, HealthData> configMap = new Dictionary<string, HealthData>();
        public List<Stats> stats = new List<Stats>();
        public int Hp { get => hp; set => hp = value; }

        public void TakeDamage(int amount)
        {
            hp -= amount;
        }

        public void ApplyDamage(int amount)
        {
            TakeDamage(amount);
        }

        public IEnumerator Respawn(GameManager manager)
        {
            yield return null;
        }

        public class Stats
        {
            public int kills;
        }
    }
}
