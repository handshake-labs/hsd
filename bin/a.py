import requests
import json

WALLET_URL = 'http://127.0.0.1:12039/'
wallet_name = 'alvin'
domain = 'ryanchen'
address = "hs1q582426apmvr28g4qcy9yvv8m624aamecpq3h45"


def a(bid):
    resp = requests.get(WALLET_URL+'wallet/'+wallet_name+'/nonce/'+domain+"?address="+address+"&bid="+str(bid))
    res = json.loads(resp.text)
    return res

for bid in range(1,3000001):
    z = a(bid)
    #print(z)
    blind = z['blind']
    nonce = z['nonce']
    if blind == "47de0aa908a80d1e73e0b1440cf366a6b2b95b412a4922aa7b4d52b2d13c8833":
        print('blind', bid)
        print('blind', blind)
    if nonce == "47de0aa908a80d1e73e0b1440cf366a6b2b95b412a4922aa7b4d52b2d13c8833":
        print('nonce', nonce)
