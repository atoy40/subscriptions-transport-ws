import {
  assert,
  expect,
} from 'chai';

import {
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString,
} from 'graphql';

import { SubscriptionManager } from 'graphql-subscriptions';

import {
  SUBSCRIPTION_FAIL,
  SUBSCRIPTION_DATA,
} from '../messageTypes';

import { createServer } from 'http';
import Server from '../server';
import Client from '../client';

const data = {
  '1': {
    'id': '1',
    'name': 'Dan',
  },
  '2': {
    'id': '2',
    'name': 'Marie',
  },
  '3': {
    'id': '3',
    'name': 'Jessie',
  },
};

const userType = new GraphQLObjectType({
  name: 'User',
  fields: {
    id: { type: GraphQLString },
    name: { type: GraphQLString },
  },
});

const schema = new GraphQLSchema({
  query: new GraphQLObjectType({
    name: 'Query',
    fields: {
      testString: { type: GraphQLString },
    },
  }),
  subscription: new GraphQLObjectType({
    name: 'Subscription',
    fields: {
      user: {
        type: userType,
        // `args` describes the arguments that the `user` query accepts
        args: {
          id: { type: GraphQLString },
        },
        // The resolve function describes how to 'resolve' or fulfill
        // the incoming query.
        // In this case we use the `id` argument from above as a key
        // to get the User from `data`
        resolve: function (_, {id}) {
          return data[id];
        },
      },
      userFiltered: {
        type: userType,
        args: {
          id: { type: GraphQLString },
        },
        resolve: function (_, {id}) {
          return data[id];
        },
      },
      error: { type: GraphQLString, resolve: () => { throw new Error('E1'); } },
    },
  }),
});

const subscriptionManager = new SubscriptionManager({
  schema,
  setupFunctions: {
    'userFiltered': (options, args) => ({
      'userFiltered': user => {
        return !args.id || user.id === args.id;
      },
    }),
  },
});

const options = {
  subscriptionManager,
  onSubscribe: (msg, params) => params,
};

const httpServer = createServer(function(request, response) {
    response.writeHead(404);
    response.end();
  });

httpServer.listen(8080, function() {
  // console.log('Server is listening on port 8080');
});
new Server(options, httpServer);

describe('Client', function() {

  it('removes subscription when it unsubscribes from it', function() {
    const client = new Client('ws://localhost:8080/');

    setTimeout( () => {
      let subId = client.subscribe({
        query:
        `subscription useInfo($id: String) {
          user(id: $id) {
            id
            name
          }
        }`,
        operationName: 'useInfo',
        variables: {
          id: 3,
        },
        }, function(error, result) {
          //do nothing
        }
      );
      client.unsubscribe(subId);
      assert.notProperty(client.subscriptionHandlers, `${subId}`);
    }, 100);
  });

  it('should call error handler when graphql result has errors', function(done) {
    const client = new Client('ws://localhost:8080/');

    setTimeout( () => {
    client.subscribe({
        query:
        `subscription useInfo{
          error
        }`,
        operationName: 'useInfo',
        variables: {},
        }, function(error, result) {
          if (error) {
            client.unsubscribeAll();
            done();
          }
          if (result) {
            client.unsubscribeAll();
            assert(false);
          }
        }
      );
    }, 100);
    setTimeout( () => {
      subscriptionManager.publish('error', {});
    }, 200);
  });

  it('should throw an error when the susbcription times out', function(done) {
    // hopefully 1ms is fast enough to time out before the server responds
    const client = new Client('ws://localhost:8080/', { timeout: 1 });

    setTimeout( () => {
    client.subscribe({
        query:
        `subscription useInfo{
          error
        }`,
        operationName: 'useInfo',
        variables: {},
        }, function(error, result) {
          if (error) {
            expect(error.message).to.equals('Subscription timed out - no response from server');
            done();
          }
          if (result) {
            assert(false);
          }
        }
      );
    }, 100);
  });
});

describe('Server', function() {

  it('should send correct results to multiple clients with subscriptions', function(done) {

    const client = new Client('ws://localhost:8080/');
    let client1 = new Client('ws://localhost:8080');

    let numResults = 0;
    setTimeout( () => {
      client.subscribe({
        query:
        `subscription useInfo($id: String) {
          user(id: $id) {
            id
            name
          }
        }`,
        operationName: 'useInfo',
        variables: {
          id: 3,
        },

      }, function(error, result) {
        if (error) {
          assert(false);
        }
        if (result) {
          assert.property(result, 'user');
          assert.equal(result.user.id, '3');
          assert.equal(result.user.name, 'Jessie');
          numResults++;
        } else {
          // pass
        }
        // if both error and result are null, this was a SUBSCRIPTION_SUCCESS message.
      });
    }, 100);

    const client11 = new Client('ws://localhost:8080/');
    let numResults1 = 0;
    setTimeout(function() {
      client11.subscribe({
        query:
        `subscription useInfo($id: String) {
          user(id: $id) {
            id
            name
          }
        }`,
        operationName: 'useInfo',
        variables: {
          id: 2,
        },

      }, function(error, result) {

      if (error) {
        assert(false);
      }
      if (result) {
        assert.property(result, 'user');
        assert.equal(result.user.id, '2');
        assert.equal(result.user.name, 'Marie');
        numResults1++;
      }
      // if both error and result are null, this was a SUBSCRIPTION_SUCCESS message.
      });
    }, 100);

    setTimeout(() => {
      subscriptionManager.publish('user', {});
    }, 200);

    setTimeout(() => {
      client.unsubscribeAll();
      expect(numResults).to.equals(1);
      client1.unsubscribeAll();
      expect(numResults1).to.equals(1);
      done();
    }, 300);

  });

  it('should send a subscription_fail message to client with invalid query', function(done) {
    const client1 = new Client('ws://localhost:8080/');
    setTimeout(function() {
      client1.client.onmessage = (message) => {
        let messageData = JSON.parse(message.data);
        assert.equal(messageData.type, SUBSCRIPTION_FAIL);
        assert.isAbove(messageData.payload.errors.length, 0, 'Number of errors is greater than 0.');
        done();
      };
      client1.subscribe({
        query:
        `subscription useInfo($id: String) {
          user(id: $id) {
            id
            birthday
          }
        }`,
        operationName: 'useInfo',
        variables: {
          id: 3,
        },
        }, function(error, result) {
          //do nothing
        }
      );
    }, 100);

  });

  it('should set up the proper filters when subscribing', function(done) {
    let numTriggers = 0;
    const client3 = new Client('ws://localhost:8080/');
    const client4 = new Client('ws://localhost:8080/');
    setTimeout(() => {
      client3.subscribe({
        query:
          `subscription userInfoFilter1($id: String) {
            userFiltered(id: $id) {
              id
              name
            }
          }`,
          operationName: 'userInfoFilter1',
          variables: {
            id: 3,
          },
        }, (error, result) => {
          if (error) {
            assert(false);
          }
          if (result) {
            numTriggers += 1;
            assert.property(result, 'userFiltered');
            assert.equal(result.userFiltered.id, '3');
            assert.equal(result.userFiltered.name, 'Jessie');
          }
          // both null means it's a SUBSCRIPTION_SUCCESS message
        }
      );
      client4.subscribe({
        query:
          `subscription userInfoFilter1($id: String) {
            userFiltered(id: $id) {
              id
              name
            }
          }`,
          operationName: 'userInfoFilter1',
          variables: {
            id: 1,
          },
        }, (error, result) => {
          if (result) {
            numTriggers += 1;
            assert.property(result, 'userFiltered');
            assert.equal(result.userFiltered.id, '1');
            assert.equal(result.userFiltered.name, 'Dan');
          }
          if (error) {
            assert(false);
          }
          // both null means SUBSCRIPTION_SUCCESS
        }
      );
    }, 100);
    setTimeout(() => {
      subscriptionManager.publish('userFiltered', { id: 1 });
      subscriptionManager.publish('userFiltered', { id: 2 });
      subscriptionManager.publish('userFiltered', { id: 3 });
    }, 200);
    setTimeout(() => {
      assert.equal(numTriggers, 2);
      done();
    }, 300);
  });

  it('does not send more subscription data after client unsubscribes', function() {
    const client4 = new Client('ws://localhost:8080/');
    setTimeout(() => {
      let subId = client4.subscribe({
        query:
        `subscription useInfo($id: String) {
          user(id: $id) {
            id
            name
          }
        }`,
        operationName: 'useInfo',
        variables: {
          id: 3,
        },
        }, function(error, result) {
          //do nothing
        }
      );
      client4.unsubscribe(subId);
    }, 100);
    setTimeout(() => {
      subscriptionManager.publish('user', {});
    }, 200);

    client4.client.onmessage = (message) => {
      if (JSON.parse(message.data).type === SUBSCRIPTION_DATA) {
        assert(false);
      }
    };
  });
});

